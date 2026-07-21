#!/usr/bin/env bash
# Starts the backend gateway (npm run dev) and frontend dev server
# (npm run dev:web) together, and stops both on Ctrl-C / exit.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
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

npm run dev &
pids+=($!)

npm run dev:web &
pids+=($!)

wait
