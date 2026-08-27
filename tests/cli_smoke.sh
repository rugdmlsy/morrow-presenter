#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/morrow-presenter"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DECK="$TMP_DIR/smoke.morrowdeck"
COPY="$TMP_DIR/exported/copy.morrowdeck"
mkdir -p "$TMP_DIR/exported"

"$CLI" new "$DECK" --title "Smoke" >/dev/null
"$CLI" set "$DECK" 1 --layout title --title "Opening" >/dev/null
"$CLI" add "$DECK" --after 1 --layout blank --title "Object slide" >/dev/null
"$CLI" slide-style "$DECK" 2 --background '#f7f7f8' --notes 'Speaker note' --transition fade --transition-duration 0.3 >/dev/null

TEXT_ID=$("$CLI" element-add-text "$DECK" 2 'Hello' --x 10 --y 10 --width 28 --height 12 --font-size 30 --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
SHAPE_ID=$("$CLI" element-add-shape "$DECK" 2 --shape rounded-rect --text 'Box' --x 48 --y 15 --width 24 --height 18 --fill '#ffeeaa' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
"$CLI" element-update "$DECK" 2 "$TEXT_ID" --rotation 12 --font-weight 700 --italic --underline --align center >/dev/null
"$CLI" element-align "$DECK" 2 top "$TEXT_ID" "$SHAPE_ID" >/dev/null
"$CLI" element-order "$DECK" 2 "$SHAPE_ID" --to-front >/dev/null
"$CLI" element-duplicate "$DECK" 2 "$TEXT_ID" >/dev/null

SYSTEM_IMAGE="/System/Library/Image Capture/Automatic Tasks/MakePDF.app/Contents/Resources/horiz.jpg"
if [[ -f "$SYSTEM_IMAGE" ]]; then
  IMG1=$("$CLI" element-add-image "$DECK" 2 "$SYSTEM_IMAGE" --x 18 --y 48 --width 27 --alt 'One' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
  IMG2=$("$CLI" element-add-image "$DECK" 2 "$SYSTEM_IMAGE" --x 55 --y 48 --width 24 --alt 'Two' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
  "$CLI" element-update "$DECK" 2 "$IMG1" --scale 1.2 --crop-left 7 --crop-top 4 --crop-right 9 --crop-bottom 6 --rotation 5 >/dev/null
fi

"$CLI" validate "$DECK" --json >/dev/null
"$CLI" export "$DECK" "$COPY" >/dev/null
"$CLI" schema --json >/dev/null
"$CLI" capabilities --json >/dev/null

python3 - "$DECK" "$COPY" <<'PY'
import json, sys
from pathlib import Path

deck = json.loads(Path(sys.argv[1]).read_text())
copy = json.loads(Path(sys.argv[2]).read_text())
assert deck == copy
assert deck["version"] == 1
assert len(deck["slides"]) == 2
slide = deck["slides"][1]
assert slide["layout"] == "blank"
assert slide["background"] == "#f7f7f8"
assert slide["notes"] == "Speaker note"
assert slide["transition"] == {"type": "fade", "duration": 0.3}
assert len(slide["elements"]) >= 3
texts = [e for e in slide["elements"] if e["type"] == "text"]
shapes = [e for e in slide["elements"] if e["type"] == "shape"]
images = [e for e in slide["elements"] if e["type"] == "image"]
assert len(texts) == 2
assert texts[0]["fontWeight"] == 700 and texts[0]["italic"] and texts[0]["underline"]
assert texts[0]["rotation"] == 12
assert shapes and shapes[0]["shape"] == "rounded-rect"
assert texts[0]["y"] == shapes[0]["y"]
if images:
    assert len(images) == 2
    assert images[0]["crop"] == {"left": 7.0, "top": 4.0, "right": 9.0, "bottom": 6.0}
    assert images[0]["rotation"] == 5
    assert images[0]["path"] == images[1]["path"]  # content-addressed dedupe
    for image in images:
        assert (Path(sys.argv[1]).parent / image["path"]).is_file()
        assert (Path(sys.argv[2]).parent / image["path"]).is_file()
print("CLI_SMOKE_OK")
PY

# Old single-image decks must normalize into elements[] instead of being stranded.
if [[ -f "$SYSTEM_IMAGE" ]]; then
  LEGACY="$TMP_DIR/legacy.morrowdeck"
  mkdir -p "$TMP_DIR/.morrow-assets"
  cp "$SYSTEM_IMAGE" "$TMP_DIR/.morrow-assets/legacy.jpg"
  cat > "$LEGACY" <<'JSON'
{"version":1,"title":"Legacy","selectedId":"s","slides":[{"id":"s","layout":"title-body","title":"t","body":"b","image":{"path":".morrow-assets/legacy.jpg","alt":"legacy","placement":"right","fit":"cover"}}]}
JSON
  "$CLI" get "$LEGACY" 1 --json > "$TMP_DIR/legacy.json"
  python3 - "$TMP_DIR/legacy.json" <<'PY'
import json,sys
slide=json.load(open(sys.argv[1]))
assert "image" not in slide
assert len(slide["elements"]) == 1
assert slide["elements"][0]["type"] == "image"
print("LEGACY_MIGRATION_OK")
PY
fi
