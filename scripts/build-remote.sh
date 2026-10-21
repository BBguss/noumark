#!/usr/bin/env bash
# Cross-compiles the Windows installer on a Linux build host over SSH and copies
# the results back to ./release. See docs/building.md for the host setup.
#
# Usage:  ./scripts/build-remote.sh user@host
#    or:  NOUMARK_BUILD_HOST=user@host ./scripts/build-remote.sh
set -euo pipefail

HOST="${1:-${NOUMARK_BUILD_HOST:-}}"
if [ -z "$HOST" ]; then
  echo "usage: $0 user@host   (or set NOUMARK_BUILD_HOST)" >&2
  exit 1
fi
REMOTE_DIR="${NOUMARK_REMOTE_DIR:-noumark-build}"
TARGET="x86_64-pc-windows-msvc"
cd "$(dirname "$0")/.."

echo "==> Syncing sources to $HOST:~/$REMOTE_DIR"
tar czf - --exclude=node_modules --exclude=dist --exclude=src-tauri/target \
  --exclude=src-tauri/gen --exclude=release --exclude=.git . \
  | ssh "$HOST" "mkdir -p ~/$REMOTE_DIR && tar xzf - -C ~/$REMOTE_DIR"

echo "==> Building on $HOST"
ssh "$HOST" "source ~/.cargo/env && cd ~/$REMOTE_DIR \
  && npm ci --no-audit --no-fund --loglevel=error \
  && cargo tauri build --runner cargo-xwin --target $TARGET"

echo "==> Fetching artifacts"
mkdir -p release
scp "$HOST:~/$REMOTE_DIR/src-tauri/target/$TARGET/release/bundle/nsis/*.exe" release/
scp "$HOST:~/$REMOTE_DIR/src-tauri/target/$TARGET/release/noumark.exe" release/Noumark-portable.exe
ls -lh release
