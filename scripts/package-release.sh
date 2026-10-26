#!/bin/sh
set -eu

publish=false
whisper=false

usage() {
  cat <<'EOF'
Usage: scripts/package-release.sh [--whisper] [--publish]

Build the embedded Web UI and release binaries, then write a versioned tarball
under target/release-package/. The script reuses this checkout's target directory
and sets CARGO_INCREMENTAL=0.

--whisper  Build codex-bridge with the whisper feature.
--publish  Upload the tarball to the GitHub release for v<version>.
           The tag must already exist and point at HEAD. This script does not
           commit, tag, push, install, or restart a running Bridge.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --publish) publish=true ;;
    --whisper) whisper=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

version=$(awk -F'"' '/^version = / { print $2; exit }' Cargo.toml)
if [ -z "$version" ]; then
  echo "workspace version was not found in Cargo.toml" >&2
  exit 1
fi
tag="v$version"
notes="docs/releases/$tag.md"

if [ "$publish" = true ]; then
  command -v gh >/dev/null 2>&1 || {
    echo "gh is required for --publish" >&2
    exit 1
  }
  if [ -n "$(git status --porcelain)" ]; then
    echo "working tree is dirty; commit the release revision before --publish" >&2
    exit 1
  fi
  if ! git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
    echo "tag $tag does not exist; create and push it before --publish" >&2
    exit 1
  fi
  if ! git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null; then
    echo "tag $tag is not on origin; push it before --publish" >&2
    exit 1
  fi
  head_commit=$(git rev-parse HEAD)
  tag_commit=$(git rev-list -n 1 "$tag")
  if [ "$head_commit" != "$tag_commit" ]; then
    echo "HEAD does not match $tag; checkout that tag before packaging a release" >&2
    exit 1
  fi
fi

command -v npm >/dev/null 2>&1 || {
  echo "npm is required to build the embedded Web UI" >&2
  exit 1
}
command -v cargo >/dev/null 2>&1 || {
  echo "cargo is required to build release binaries" >&2
  exit 1
}
if [ ! -f web-ui/package-lock.json ]; then
  echo "web-ui/package-lock.json is required" >&2
  exit 1
fi

host=$(rustc -vV | awk -F': ' '/^host: / { print $2; exit }')
if [ -z "$host" ]; then
  echo "rustc did not report a host target" >&2
  exit 1
fi

echo "building web-ui for $tag"
npm ci --prefix web-ui
npm --prefix web-ui run build
test -s web-ui/dist/index.html
test -s web-ui/dist/assets/app.js
test -s web-ui/dist/assets/app.css

echo "building release binaries"
export CARGO_INCREMENTAL=0
if [ "$whisper" = true ]; then
  cargo build --release --locked -p codex-bridge --features whisper
else
  cargo build --release --locked -p codex-bridge
fi
cargo build --release --locked -p codexctl -p codex-gui-bridge --bin ws-unix-bridge

package_name="codex-bridge-$version-$host"
if [ "$whisper" = true ]; then
  package_name="$package_name-whisper"
fi
out_dir="$repo_root/target/release-package"
stage="$out_dir/$package_name"
archive="$out_dir/$package_name.tar.gz"
rm -rf "$stage"
mkdir -p "$stage"

install -m 755 target/release/codex-bridge "$stage/codex-bridge"
install -m 755 target/release/codexctl "$stage/codexctl"
install -m 755 target/release/ws-unix-bridge "$stage/ws-unix-bridge"

version_line=$("$stage/codex-bridge" --version)
case "$version_line" in
  *" $version") ;;
  *)
    echo "packaged codex-bridge version does not match Cargo.toml: $version_line" >&2
    exit 1
    ;;
esac

(
  cd "$stage"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum codex-bridge codexctl ws-unix-bridge > SHA256SUMS
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 codex-bridge codexctl ws-unix-bridge > SHA256SUMS
  else
    echo "sha256sum or shasum is required" >&2
    exit 1
  fi
)

rm -f "$archive"
tar -C "$out_dir" -czf "$archive" "$package_name"
checksum_file="$out_dir/$package_name.tar.gz.sha256"
(
  cd "$out_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$package_name.tar.gz" > "$package_name.tar.gz.sha256"
  else
    shasum -a 256 "$package_name.tar.gz" > "$package_name.tar.gz.sha256"
  fi
)
echo "package: target/release-package/$package_name.tar.gz"

if [ "$publish" = true ]; then
  if ! gh release view "$tag" >/dev/null 2>&1; then
    if [ ! -f "$notes" ]; then
      echo "missing $notes; create the release notes before --publish" >&2
      exit 1
    fi
    gh release create "$tag" \
      --title "Codex App Server WebUI $tag" \
      --notes-file "$notes"
  fi
  gh release upload "$tag" "$archive" "$checksum_file" --clobber
  echo "uploaded to GitHub release $tag"
fi
