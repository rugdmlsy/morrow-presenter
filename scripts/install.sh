#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build-app.sh" >/dev/null

if [[ -w /Applications ]]; then
  APP_DIR="/Applications"
else
  APP_DIR="$HOME/Applications"
  mkdir -p "$APP_DIR"
fi

rm -rf "$APP_DIR/Morrow Presenter.app"
ditto "$ROOT/dist/Morrow Presenter.app" "$APP_DIR/Morrow Presenter.app"

if [[ -d /opt/homebrew/bin && -w /opt/homebrew/bin ]]; then
  BIN_DIR="/opt/homebrew/bin"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
fi

chmod +x "$ROOT/bin/morrow-presenter"
ln -sfn "$ROOT/bin/morrow-presenter" "$BIN_DIR/morrow-presenter"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$APP_DIR/Morrow Presenter.app" >/dev/null 2>&1 || true
fi
printf 'App: %s\nCLI: %s\n' "$APP_DIR/Morrow Presenter.app" "$BIN_DIR/morrow-presenter"
