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
"$CLI" element-update "$DECK" 2 @title --x 18 --y 6 --width 52 --height 14 >/dev/null

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
role_title = next(e for e in texts if e.get("role") == "title")
normal_texts = [e for e in texts if e.get("role") is None]
shapes = [e for e in slide["elements"] if e["type"] == "shape"]
images = [e for e in slide["elements"] if e["type"] == "image"]
assert role_title["text"] == "Object slide"
assert (role_title["x"], role_title["y"], role_title["width"], role_title["height"]) == (18.0, 6.0, 52.0, 14.0)
assert len(normal_texts) == 2
assert normal_texts[0]["fontWeight"] == 700 and normal_texts[0]["italic"] and normal_texts[0]["underline"]
assert normal_texts[0]["rotation"] == 12
assert shapes and shapes[0]["shape"] == "rounded-rect"
assert normal_texts[0]["y"] == shapes[0]["y"]
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

# Canonical development format: every element must declare its type.
UNTYPED="$TMP_DIR/untyped-element.morrowdeck"
cp "$DECK" "$UNTYPED"
python3 - "$UNTYPED" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p))
d['slides'][0]['elements'].append({'path':'.morrow-assets/not-an-element.jpg'})
open(p,'w').write(json.dumps(d,indent=2)+'\n')
PY
if "$CLI" validate "$UNTYPED" >/dev/null 2>&1; then
  echo 'untyped element unexpectedly accepted' >&2
  exit 1
fi

# Only generic element image operations are part of the CLI surface.
"$CLI" capabilities --json | python3 -c 'import json,sys; ops=set(json.load(sys.stdin)["operations"]); required={"element-add-image","element-update","element-delete"}; assert required <= ops; print("CANONICAL_FORMAT_ONLY_OK")'
