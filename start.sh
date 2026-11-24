#!/usr/bin/env bash
# Starts the backend gateway (npm run dev) and frontend dev server
# (npm run dev:web) together, and stops both on Ctrl-C / exit.
# Pass --demo to run the gateway in demo mode (npm run dev:demo) instead.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

backend_script=dev
case "${1:-}" in
  "") ;;
  --demo) backend_script=dev:demo ;;
  *) echo "usage: $0 [--demo]" >&2; exit 2 ;;
esac
set -m # each background job gets its own process group, so we can kill it and its children together

pids=()
cleanup() {
  echo ""
  echo "[start.sh] shutting down..."
  for pid in "${pids[@]}"; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run "$backend_script" &
pids+=($!)

npm run dev:web &
pids+=($!)

wait
