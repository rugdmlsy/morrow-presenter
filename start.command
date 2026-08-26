#!/bin/zsh
set -e
cd "$(dirname "$0")"
PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}"

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/morrow-presenter.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
sleep 0.5
open "$URL"
wait $SERVER_PID
