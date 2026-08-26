#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/morrow-presenter"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DECK="$TMP_DIR/smoke.morrowdeck"
COPY="$TMP_DIR/copy.json"

"$CLI" new "$DECK" --title "Smoke" >/dev/null
"$CLI" set "$DECK" 1 --layout title --title "Opening" >/dev/null
"$CLI" add "$DECK" --after 1 --layout title-body --title "Problem" --body $'One\nTwo' >/dev/null
"$CLI" duplicate "$DECK" 2 >/dev/null
"$CLI" move "$DECK" 3 --to 2 >/dev/null
"$CLI" delete "$DECK" 3 >/dev/null
"$CLI" title "$DECK" "Smoke Renamed" >/dev/null
SYSTEM_IMAGE="/System/Library/Image Capture/Automatic Tasks/MakePDF.app/Contents/Resources/horiz.jpg"
if [[ -f "$SYSTEM_IMAGE" ]]; then
  "$CLI" image-set "$DECK" 2 "$SYSTEM_IMAGE" --x 11 --y 17 --width 36 --alt "System test image" >/dev/null
  "$CLI" image-update "$DECK" 2 --x 19 --y 8 --scale 1.25 --crop-left 7 --crop-top 4 --crop-right 9 --crop-bottom 6 --alt "Updated system image" >/dev/null
fi
"$CLI" validate "$DECK" --json >/dev/null
"$CLI" export "$DECK" "$COPY" >/dev/null

python3 - "$DECK" "$COPY" <<'PY'
import json, sys
from pathlib import Path

deck = json.loads(Path(sys.argv[1]).read_text())
copy = json.loads(Path(sys.argv[2]).read_text())
assert deck == copy
assert deck["version"] == 1
assert deck["title"] == "Smoke Renamed"
assert len(deck["slides"]) == 2
assert deck["slides"][0]["title"] == "Opening"
assert deck["slides"][0]["layout"] == "title"
assert deck["slides"][1]["title"] == "Problem"
assert deck["slides"][1]["body"] == "One\nTwo"
if "image" in deck["slides"][1]:
    image = deck["slides"][1]["image"]
    assert image["x"] == 19.0
    assert image["y"] == 8.0
    assert image["width"] == 45.0
    assert image["height"] > 0
    assert image["intrinsicWidth"] > 0 and image["intrinsicHeight"] > 0
    assert image["crop"] == {"left": 7.0, "top": 4.0, "right": 9.0, "bottom": 6.0}
    assert image["alt"] == "Updated system image"
    assert image["path"].startswith(".morrow-assets/")
    assert (Path(sys.argv[1]).parent / image["path"]).is_file()
    assert (Path(sys.argv[2]).parent / image["path"]).is_file()
print("CLI_SMOKE_OK")
PY
