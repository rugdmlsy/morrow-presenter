#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/dist/Morrow Presenter.app"
if [[ ! -d "$APP" ]]; then
  "$ROOT/scripts/build-app.sh" >/dev/null
fi
open "$APP"
