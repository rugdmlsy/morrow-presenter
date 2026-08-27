#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/morrow-presenter"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DECK="$TMP_DIR/advanced.morrowdeck"
PDF="$TMP_DIR/advanced.pdf"
PPTX="$TMP_DIR/advanced.pptx"
ROUNDTRIP="$TMP_DIR/roundtrip.morrowdeck"
SYSTEM_IMAGE="/System/Library/Image Capture/Automatic Tasks/MakePDF.app/Contents/Resources/horiz.jpg"

"$CLI" new "$DECK" --title "Advanced smoke" >/dev/null
"$CLI" set "$DECK" 1 --layout blank >/dev/null
"$CLI" theme-set "$DECK" dark --apply-all >/dev/null
"$CLI" view-settings "$DECK" --snap-to-grid --show-grid --grid-size 5 --guide-x 25 --guide-x 75 --guide-y 40 >/dev/null

A=$("$CLI" element-add-shape "$DECK" 1 --shape rounded-rect --text Agent --x 8 --y 12 --width 24 --height 16 --fill '#dbeafe' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
B=$("$CLI" element-add-shape "$DECK" 1 --shape ellipse --text System --x 68 --y 12 --width 24 --height 16 --fill '#e0f2fe' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
CONN=$("$CLI" element-add-connector "$DECK" 1 "$A" "$B" --arrow both --dash --stroke '#64748b' --stroke-width 2.5 --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
TABLE=$("$CLI" element-add-table "$DECK" 1 --rows 2 --cols 2 --cells-json '[["Metric","Value"],["Pass","24/24"]]' --x 8 --y 48 --width 42 --height 32 --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["element"]["id"])')
"$CLI" table-set "$DECK" 1 "$TABLE" 2 1 Recovery >/dev/null
"$CLI" table-set "$DECK" 1 "$TABLE" 2 2 Local >/dev/null
"$CLI" table-row-add "$DECK" 1 "$TABLE" --at 2 >/dev/null
"$CLI" table-row-delete "$DECK" 1 "$TABLE" --at 2 >/dev/null
"$CLI" table-col-add "$DECK" 1 "$TABLE" --at 2 >/dev/null
"$CLI" table-col-delete "$DECK" 1 "$TABLE" --at 2 >/dev/null

GROUP=$("$CLI" element-group "$DECK" 1 "$A" "$B" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["groupId"])')
"$CLI" element-ungroup "$DECK" 1 "$A" >/dev/null
"$CLI" element-group "$DECK" 1 "$A" "$B" >/dev/null

if [[ -f "$SYSTEM_IMAGE" ]]; then
  "$CLI" element-add-image "$DECK" 1 "$SYSTEM_IMAGE" --x 58 --y 48 --width 32 --alt 'Existing system image' >/dev/null
fi

"$CLI" validate "$DECK" --json >/dev/null

python3 - "$DECK" "$A" "$B" "$CONN" "$TABLE" "$GROUP" <<'PY'
import json,sys
from pathlib import Path
p,a,b,conn,table,first_group=sys.argv[1:]
deck=json.loads(Path(p).read_text())
assert deck['theme']['name']=='dark'
assert deck['view']['snapToGrid'] is True and deck['view']['showGrid'] is True
assert deck['view']['gridSize']==5.0
assert deck['view']['guideX']==[25.0,75.0]
assert deck['view']['guideY']==[40.0]
slide=deck['slides'][0]
byid={e['id']:e for e in slide['elements']}
assert byid[conn]['type']=='connector'
assert byid[conn]['from']['elementId']==a and byid[conn]['to']['elementId']==b
assert byid[conn]['arrow']=='both' and byid[conn]['dash'] is True
assert byid[table]['type']=='table'
assert byid[table]['rows']==2 and byid[table]['cols']==2
assert byid[table]['cells'][1]==['Recovery','Local']
assert byid[a]['groupId'] and byid[a]['groupId']==byid[b]['groupId']
assert byid[a]['groupId'] != first_group  # ungroup + regroup creates a new group identity
print('ADVANCED_MODEL_OK')
PY

"$CLI" export-pdf "$DECK" "$PDF" >/dev/null
"$CLI" export-pptx "$DECK" "$PPTX" >/dev/null
[[ -s "$PDF" && -s "$PPTX" ]]
python3 - "$PDF" <<'PY'
import sys
assert open(sys.argv[1],'rb').read(5)==b'%PDF-'
print('PDF_EXPORT_OK')
PY
unzip -tq "$PPTX" >/dev/null
echo PPTX_EXPORT_OK

"$CLI" import-pptx "$PPTX" "$ROUNDTRIP" >/dev/null
"$CLI" validate "$ROUNDTRIP" --json >/dev/null
python3 - "$ROUNDTRIP" <<'PY'
import json,sys
from pathlib import Path
deck=json.loads(Path(sys.argv[1]).read_text())
assert len(deck['slides'])==1
types=[e['type'] for e in deck['slides'][0]['elements']]
assert 'table' in types
if any(e.get('path') for e in deck['slides'][0]['elements'] if e['type']=='image'):
    for e in deck['slides'][0]['elements']:
        if e['type']=='image': assert (Path(sys.argv[1]).parent/e['path']).is_file()
print('PPTX_ROUNDTRIP_OK', ','.join(sorted(set(types))))
PY

echo ADVANCED_SMOKE_OK
