#!/usr/bin/env bash
set -euo pipefail

# Simple helper to start gateway and mobile dev servers in background and log output.
# Run from repo root: ./scripts/start-lan-dev.sh

LOGDIR=./.logs
mkdir -p "$LOGDIR"

npm run dev:gateway > "$LOGDIR/gateway.log" 2>&1 &
GW_PID=$!

echo "Gateway started (pid=$GW_PID), logs: $LOGDIR/gateway.log"

npm run dev:mobile > "$LOGDIR/mobile.log" 2>&1 &
MOBILE_PID=$!

echo "Mobile PWA started (pid=$MOBILE_PID), logs: $LOGDIR/mobile.log"

echo "To stop: kill $GW_PID $MOBILE_PID"

wait
