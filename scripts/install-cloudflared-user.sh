#!/bin/sh
set -eu

action=check
start_service=true
config_path=${XDG_CONFIG_HOME:-"$HOME/.config"}/cloudflared/config.yml

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) action=check ;;
    --install) action=install ;;
    --no-start) start_service=false ;;
    --config)
      [ "$#" -ge 2 ] || { echo "--config requires a path" >&2; exit 2; }
      config_path=$2
      shift
      ;;
    -h|--help)
      echo "Usage: scripts/install-cloudflared-user.sh [--check|--install] [--config PATH] [--no-start]"
      echo "Creates a systemd --user wrapper only; it never creates Cloudflare tunnels, DNS, or Access policies."
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Linux" ]; then
  echo "install-cloudflared-user.sh must run on Linux" >&2
  exit 1
fi

cloudflared_bin=$(command -v cloudflared || true)
if [ -z "$cloudflared_bin" ]; then
  echo "cloudflared was not found on PATH; install it from Cloudflare, then rerun this check." >&2
  exit 1
fi
if [ ! -f "$config_path" ]; then
  echo "Cloudflare Tunnel configuration does not exist: $config_path" >&2
  echo "Create it with a Named Tunnel and a loopback-only ingress before installing the user service." >&2
  exit 1
fi

if grep -Fq 'trycloudflare.com' "$config_path"; then
  echo "Quick Tunnels are not supported; configure a Named Tunnel instead." >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*service:[[:space:]]*http://127\.0\.0\.1:18791/?[[:space:]]*$' "$config_path"; then
  echo "The tunnel ingress must target http://127.0.0.1:18791." >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*(tunnel|credentials-file):[[:space:]]*[^#[:space:]]+' "$config_path"; then
  echo "The configuration must identify a Named Tunnel with tunnel or credentials-file." >&2
  exit 1
fi

version=$($cloudflared_bin --version 2>/dev/null || true)
echo "cloudflared: ${version:-present}"
echo "tunnel config: $config_path"
echo "origin: http://127.0.0.1:18791 (loopback only)"
if ! "$cloudflared_bin" tunnel --config "$config_path" ingress validate >/dev/null 2>&1; then
  echo "cloudflared rejected the tunnel ingress configuration; run: cloudflared tunnel --config $config_path ingress validate" >&2
  exit 1
fi
echo "cloudflared ingress validation: passed"

if [ "$action" = check ]; then
  echo "Preflight passed. Use --install to create the user-level service."
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required to install the user service" >&2
  exit 1
fi
if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "systemd --user is unavailable for this account" >&2
  exit 1
fi

systemd_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
mkdir -p "$systemd_dir"
chmod 700 "$systemd_dir"
unit_path=$systemd_dir/codex-bridge-cloudflared.service

cat >"$unit_path" <<EOF
[Unit]
Description=Cloudflare Named Tunnel for Codex Bridge
After=network-online.target codex-bridge.service
Wants=network-online.target

[Service]
ExecStart="$cloudflared_bin" --config "$config_path" tunnel run
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable codex-bridge-cloudflared.service
if [ "$start_service" = true ]; then
  systemctl --user restart codex-bridge-cloudflared.service
fi
echo "Installed user service: $unit_path"
echo "Bridge authentication must remain enabled; Cloudflare Access is an additional layer, not a replacement."
