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
mkdir -p "$RESOURCES/Scripts"
cp "$ROOT/scripts/export-pdf.py" "$ROOT/scripts/export-pptx.py" "$ROOT/scripts/import-pptx.py" "$RESOURCES/Scripts/"
chmod +x "$RESOURCES/Scripts/export-pdf.py" "$RESOURCES/Scripts/export-pptx.py" "$RESOURCES/Scripts/import-pptx.py"

codesign --force --deep --sign - "$APP" >/dev/null
printf '%s\n' "$APP"
