#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Morrow Presenter.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

swiftc -O \
  -framework Cocoa \
  -framework WebKit \
  "$ROOT/native/AppMain.swift" \
  -o "$MACOS/MorrowPresenter"

cp "$ROOT/native/Info.plist" "$CONTENTS/Info.plist"
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$RESOURCES/"

codesign --force --deep --sign - "$APP" >/dev/null
printf '%s\n' "$APP"
