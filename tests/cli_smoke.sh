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
print("CLI_SMOKE_OK")
PY
