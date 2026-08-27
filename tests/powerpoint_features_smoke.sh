#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/morrow-presenter"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
D="$TMP/features.morrowdeck"
P="$TMP/features.pptx"
F="$TMP/features.pdf"
R="$TMP/roundtrip.morrowdeck"
S="$TMP/schema.json"

"$CLI" new "$D" --title 'PowerPoint features' >/dev/null
"$CLI" set "$D" 1 --layout blank >/dev/null
"$CLI" page-size "$D" standard >/dev/null
"$CLI" footer-set "$D" --text 'Confidential' --show-text --show-slide-number --font-size 10 --color '#777777' >/dev/null
T=$("$CLI" element-add-text "$D" 1 $'Alpha\nBeta\nGamma' --x 12 --y 12 --width 38 --height 28 --list-style bullet --line-spacing 1.4 --paragraph-spacing 6 --indent 12 --auto-fit --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["element"]["id"])')
STAR=$("$CLI" element-add-shape "$D" 1 --shape star --text Star --x 60 --y 14 --width 20 --height 20 --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["element"]["id"])')
"$CLI" element-update "$D" 1 "$STAR" --x 61.5 --y 16.5 --width 22 --height 19 --flip-h >/dev/null
for SH in triangle diamond pentagon hexagon chevron; do
  "$CLI" element-add-shape "$D" 1 --shape "$SH" --x 10 --y 55 --width 12 --height 12 >/dev/null
done

"$CLI" schema --json > "$S"
uv run --quiet --with 'jsonschema>=4.23' python - "$S" "$D" <<'PY'
import json,sys
from jsonschema import Draft202012Validator
schema=json.load(open(sys.argv[1]));deck=json.load(open(sys.argv[2]));Draft202012Validator(schema).validate(deck)
assert deck['page']=={'preset':'standard','width':10.0,'height':7.5}
assert deck['footer']['text']=='Confidential' and deck['footer']['showText'] and deck['footer']['showSlideNumber']
t=next(e for e in deck['slides'][0]['elements'] if e['type']=='text')
assert (t['listStyle'],t['lineSpacing'],t['paragraphSpacing'],t['indent'],t['autoFit'])==('bullet',1.4,6.0,12.0,True)
star=next(e for e in deck['slides'][0]['elements'] if e.get('shape')=='star')
assert star['flipH'] and (star['x'],star['y'],star['width'],star['height'])==(61.5,16.5,22.0,19.0)
assert {'triangle','diamond','pentagon','hexagon','star','chevron'} <= {e.get('shape') for e in deck['slides'][0]['elements']}
print('POWERPOINT_MODEL_OK')
PY

"$CLI" export-pdf "$D" "$F" >/dev/null
"$CLI" export-pptx "$D" "$P" >/dev/null
"$CLI" import-pptx "$P" "$R" --force >/dev/null
uv run --quiet --with 'python-pptx>=1.0.2' --with 'pypdf>=5' python - "$P" "$F" "$R" <<'PY'
from pptx import Presentation
from pypdf import PdfReader
import json,sys
prs=Presentation(sys.argv[1])
assert round(prs.slide_width/914400,3)==10.0 and round(prs.slide_height/914400,3)==7.5
names=[sh.name for sh in prs.slides[0].shapes]
assert 'MorrowPresenter:footer' in names and 'MorrowPresenter:slide-number' in names
text=next(sh for sh in prs.slides[0].shapes if getattr(sh,'has_text_frame',False) and sh.text.startswith('Alpha'))
ppr=text.text_frame.paragraphs[0]._p.pPr
assert ppr is not None and 'buChar' in ppr.xml and text.text_frame.auto_size is not None
page=PdfReader(sys.argv[2]).pages[0]
assert round(float(page.mediabox.width))==720 and round(float(page.mediabox.height))==540
pdftext=page.extract_text() or ''
assert 'Confidential' in pdftext and 'Alpha' in pdftext
roundtrip=json.load(open(sys.argv[3]))
assert roundtrip['page']['preset']=='standard'
assert roundtrip['footer']['showText'] and roundtrip['footer']['showSlideNumber'] and roundtrip['footer']['text']=='Confidential'
t=next(e for e in roundtrip['slides'][0]['elements'] if e['type']=='text')
star=next(e for e in roundtrip['slides'][0]['elements'] if e.get('shape')=='star')
assert t['listStyle']=='bullet' and abs(t['lineSpacing']-1.4)<.01 and t['autoFit']
assert star['flipH'] and abs(star['x']-61.5)<.1 and abs(star['width']-22)<.1
print('POWERPOINT_INTERCHANGE_OK')
PY

echo POWERPOINT_FEATURES_SMOKE_OK
