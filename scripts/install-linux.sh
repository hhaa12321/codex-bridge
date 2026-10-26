#!/bin/sh
set -eu

enable_web_ui=true
start_services=true
start_suppressed=false
enable_whisper=false
desktop_bridge=true
desktop_bridge_explicit=false
api_key_file=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --web-ui) enable_web_ui=true ;;
    --no-web-ui) enable_web_ui=false ;;
    --no-start) start_services=false ;;
    --whisper) enable_whisper=true ;;
    --desktop-bridge) desktop_bridge=true; desktop_bridge_explicit=true ;;
    --no-desktop-bridge) desktop_bridge=false; desktop_bridge_explicit=true ;;
    --api-key-file)
      [ "$#" -ge 2 ] || { echo "--api-key-file requires a path" >&2; exit 2; }
      api_key_file=$2
      shift
      ;;
    -h|--help)
      echo "Usage: scripts/install-linux.sh [--web-ui|--no-web-ui] [--whisper] [--api-key-file PATH] [--desktop-bridge|--no-desktop-bridge] [--no-start]"
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Linux" ]; then
  echo "install-linux.sh must run on Linux" >&2
  exit 1
fi

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cargo_bin_dir=${CARGO_HOME:-"$HOME/.cargo"}/bin
config_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/codex-bridge
config_path=$config_dir/config.toml
service_env_path=$config_dir/service.env
runtime_dir=${XDG_RUNTIME_DIR:-"/run/user/$(id -u)"}
private_dir=$HOME/.codex-bridge
systemd_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
codex_bin=$(command -v codex || true)
codex_home=${CODEX_HOME:-"$HOME/.codex"}
app_server_socket=$runtime_dir/codex-app-server.sock
ws_bridge_listen=127.0.0.1:18790
if [ -f "$config_path" ]; then
  configured_ws_bridge_listen=$(awk -F'"' '/^[[:space:]]*ws_bridge_listen[[:space:]]*=/{print $2; exit}' "$config_path")
  if [ -n "$configured_ws_bridge_listen" ]; then
    ws_bridge_listen=$configured_ws_bridge_listen
  fi
fi
case "$ws_bridge_listen" in
  127.0.0.1:[0-9]*|localhost:[0-9]*) ;;
  *) echo "services.ws_bridge_listen must be a loopback host:port" >&2; exit 1 ;;
esac
if [ -f "$config_path" ] && [ "$desktop_bridge_explicit" = false ]; then
  if grep -Eq '^[[:space:]]*desktop_interposition[[:space:]]*=[[:space:]]*false([[:space:]]*(#.*)?)?$' "$config_path"; then
    desktop_bridge=false
  elif grep -Eq '^[[:space:]]*desktop_interposition[[:space:]]*=[[:space:]]*true([[:space:]]*(#.*)?)?$' "$config_path"; then
    desktop_bridge=true
  else
    desktop_bridge=false
  fi
fi
if [ -f "$config_path" ] && awk '
  /^\[services\.whisper\][[:space:]]*([#].*)?$/ { section = 1; next }
  /^\[/ { section = 0 }
  section && /^[[:space:]]*enabled[[:space:]]*=[[:space:]]*true([[:space:]]*(#.*)?)?$/ { found = 1 }
  END { exit !found }
' "$config_path"; then
  enable_whisper=true
fi

if [ -z "$codex_bin" ]; then
  echo "standalone codex executable was not found on PATH" >&2
  exit 1
fi
codex_version=$($codex_bin --version 2>/dev/null || true)
case "$codex_version" in
  *" 0.164.0") ;;
  *)
    echo "codex-bridge requires Codex CLI 0.164.0; found: ${codex_version:-unknown}" >&2
    exit 1
    ;;
esac
codex_app_server_help=$($codex_bin app-server --help 2>/dev/null || true)
case "$codex_app_server_help" in
  *"--listen"*"unix://"*) ;;
  *)
    echo "the configured Codex CLI does not support app-server Unix WebSocket listeners" >&2
    exit 1
    ;;
esac
if [ -n "$api_key_file" ]; then
  case "$api_key_file" in
    /*) ;;
    *) echo "--api-key-file must be an absolute path" >&2; exit 1 ;;
  esac
  case "$api_key_file" in
    *'"'*|*'
'*) echo "--api-key-file must not contain quotes or newlines" >&2; exit 1 ;;
  esac
  [ -f "$api_key_file" ] || { echo "API key file does not exist: $api_key_file" >&2; exit 1; }
  [ "$(stat -c %a "$api_key_file")" = 600 ] || {
    echo "API key file must have mode 600: $api_key_file" >&2
    exit 1
  }
fi
if [ "$enable_web_ui" = true ] && ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required with --web-ui" >&2
  exit 1
fi
for command_name in cargo npm systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "required command not found: $command_name" >&2
    exit 1
  }
done

mkdir -p "$config_dir" "$private_dir" "$systemd_dir"
chmod 700 "$config_dir" "$private_dir"

npm --prefix "$repo_root/web-ui" ci
npm --prefix "$repo_root/web-ui" run build
for pwa_asset in \
  manifest.webmanifest \
  sw.js \
  offline.html \
  app-icon.png \
  app-icon-192.png \
  app-icon-maskable-512.png; do
  [ -s "$repo_root/web-ui/dist/$pwa_asset" ] || {
    echo "Web UI build is missing PWA asset: $pwa_asset" >&2
    exit 1
  }
done
if [ "$enable_whisper" = true ]; then
  CARGO_TARGET_DIR="$repo_root/target" CARGO_INCREMENTAL=0 \
    cargo install --locked --force --features whisper --path "$repo_root/crates/codex-bridge"
else
  CARGO_TARGET_DIR="$repo_root/target" CARGO_INCREMENTAL=0 \
    cargo install --locked --force --path "$repo_root/crates/codex-bridge"
fi
CARGO_TARGET_DIR="$repo_root/target" CARGO_INCREMENTAL=0 \
  cargo install --locked --force --path "$repo_root/crates/codexctl"
if [ "$desktop_bridge" = true ]; then
  CARGO_TARGET_DIR="$repo_root/target" CARGO_INCREMENTAL=0 \
    cargo install --locked --force --path "$repo_root/crates/codex-gui-bridge" --bin ws-unix-bridge
fi

web_password=$private_dir/web-ui-password
if [ "$enable_web_ui" = true ] && [ ! -s "$web_password" ]; then
  umask 077
  openssl rand -base64 32 >"$web_password"
  chmod 600 "$web_password"
fi

if [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${OPENAI_BASE_URL:-}" ]; then
  (
    umask 077
    : >"$service_env_path"
    [ -z "${OPENAI_API_KEY:-}" ] || printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY" >>"$service_env_path"
    [ -z "${OPENAI_BASE_URL:-}" ] || printf 'OPENAI_BASE_URL=%s\n' "$OPENAI_BASE_URL" >>"$service_env_path"
  )
  chmod 600 "$service_env_path"
fi

api_key_configured=false
if [ -n "${OPENAI_API_KEY:-}" ] || [ -n "$api_key_file" ]; then
  api_key_configured=true
elif [ -s "$service_env_path" ] && grep -Eq '^OPENAI_API_KEY=.+$' "$service_env_path"; then
  api_key_configured=true
elif [ -f "$codex_home/config.toml" ] && awk '
  /^[[:space:]]*(experimental_bearer_token|api_key|token)[[:space:]]*=/ {
    value = $0
    sub(/^[^=]*=[[:space:]]*/, "", value)
    if (value ~ /^"[^"]+"/ || value ~ /^'\''[^'\'']+'\''/ || value ~ /^[^"'\''[:space:]#]/) {
      found = 1
    }
  }
  END { exit !found }
' "$codex_home/config.toml"; then
  api_key_configured=true
fi
if [ "$api_key_configured" = false ]; then
  echo "No API key was found in the environment, --api-key-file, service.env, or active Codex config." >&2
  start_services=false
  start_suppressed=true
fi

if [ -n "$api_key_file" ]; then
  api_key_config_line="api_key_file = \"$api_key_file\""
else
  api_key_config_line='# api_key_file = "~/.config/codex-bridge/api-key"'
fi

managed_by_bridge=false
if [ ! -f "$config_path" ]; then
  cat >"$config_path" <<EOF
mode = "standalone"
codex_bin = "$codex_bin"
app_server_socket = "$app_server_socket"
app_server_thread_cache = 3
$api_key_config_line

[web_ui]
enabled = $enable_web_ui
listen = "127.0.0.1:18791"
user = "codex"
password_file = "$web_password"
no_auth = false
public_origins = []

[services]
manage_app_server = true
desktop_interposition = $desktop_bridge
ws_bridge_listen = "$ws_bridge_listen"
ws_bridge_bin = "$cargo_bin_dir/ws-unix-bridge"
EOF
  chmod 600 "$config_path"
  managed_by_bridge=true
else
  echo "Preserving existing configuration: $config_path"
  if grep -Eq '^[[:space:]]*manage_app_server[[:space:]]*=[[:space:]]*true([[:space:]]*(#.*)?)?$' "$config_path"; then
    managed_by_bridge=true
  fi
fi

desktop_launcher=
if [ "$desktop_bridge" = true ] && [ -x /usr/lib/chatgpt/ChatGPT ]; then
  desktop_bin_dir=$HOME/.local/bin
  desktop_launcher=$desktop_bin_dir/codex-bridge-desktop
  desktop_entry_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}/applications
  mkdir -p "$desktop_bin_dir" "$desktop_entry_dir"
  cat >"$desktop_launcher" <<'EOF'
#!/bin/sh
export CODEX_APP_SERVER_WS_URL="ws://__WS_BRIDGE_LISTEN__/rpc"
unset CODEX_APP_SERVER_USE_LOCAL_DAEMON
exec /usr/lib/chatgpt/ChatGPT "$@"
EOF
  sed -i "s|__WS_BRIDGE_LISTEN__|$ws_bridge_listen|g" "$desktop_launcher"
  chmod 700 "$desktop_launcher"
  cat >"$desktop_entry_dir/codex-bridge.desktop" <<EOF
[Desktop Entry]
Name=Codex Bridge Desktop
Comment=Codex Desktop connected to the shared Codex Bridge app-server
Exec=$desktop_launcher %U
Icon=chatgpt
Type=Application
StartupNotify=true
Categories=Utility;Development;
MimeType=x-scheme-handler/codex;
EOF
  chmod 600 "$desktop_entry_dir/codex-bridge.desktop"
fi

stdio_app_server_pids() {
  ps -axo pid=,args= | awk -v bin="$codex_bin" '
    index($0, bin " ") && index($0, " app-server") && (!index($0, " --listen") || index($0, " --listen stdio://") || index($0, " --listen=stdio://")) && !index($0, " generate-json-schema") { print $1 }
  '
}
if [ "$start_services" = true ] && [ "$managed_by_bridge" = true ]; then
  conflicting_pids=$(stdio_app_server_pids)
  if [ -n "$conflicting_pids" ]; then
    echo "Refusing to start the managed app-server while a private stdio app-server is running." >&2
    echo "The service definition will be installed without enabling it. Exit the active Codex process, then start codex-bridge.service." >&2
    start_services=false
    start_suppressed=true
  fi
fi

cat >"$systemd_dir/codex-bridge.service" <<EOF
[Unit]
Description=Codex App Server WebUI bridge
After=network.target

[Service]
ExecStart="$cargo_bin_dir/codex-bridge" --config "$config_path"
EnvironmentFile=-"$service_env_path"
KillMode=process
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
if [ "$start_services" = true ]; then
  if [ "$managed_by_bridge" = true ]; then
    systemctl --user disable --now codex-app-server.service >/dev/null 2>&1 || true
  fi
  systemctl --user enable codex-bridge.service
  if systemctl --user is-active --quiet codex-bridge.service; then
    systemctl --user restart codex-bridge.service
  else
    systemctl --user start codex-bridge.service
  fi
fi

echo "Installed user configuration: $config_path"
echo "Installed systemd user services under: $systemd_dir"
if [ "$start_suppressed" = true ]; then
  echo "Service start was deferred. Resolve the reported preflight conflict or API-key requirement, then start codex-bridge.service."
fi
if [ "$enable_web_ui" = true ]; then
  echo "Web UI: http://127.0.0.1:18791/ (password file: $web_password)"
fi
if [ -n "$desktop_launcher" ]; then
  echo "Shared Desktop launcher: $desktop_launcher"
  echo "Fully quit Codex Desktop, then launch it through the new 'Codex Bridge Desktop' entry so both clients use one app-server writer."
fi
