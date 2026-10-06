#!/bin/bash
# Detached dev-office restarter: kills the running :4519 engine and boots a fresh one
# from the current repo code (loads the Done-card fix). Runs in its own session so it
# survives the old engine's death (and the chat worker that dies with it).
DESKTOP="/Users/nimishmehta/Learning/Founders Office/desktop"
SERVERJS="/Users/nimishmehta/Learning/Founders Office/fleet-office/server.js"
LOG="$DESKTOP/dev-restart.log"
cd "$DESKTOP" || exit 1
{
  echo ">>> $(date '+%H:%M:%S') restarter start"
  sleep 4   # let the chat reply flush before we cut the cord
  OLD=$(lsof -nP -iTCP:4519 -sTCP:LISTEN -t 2>/dev/null | head -1)
  echo "old :4519 pid=$OLD"
  if [ -n "$OLD" ]; then
    PGID=$(ps -o pgid= -p "$OLD" 2>/dev/null | tr -d ' ')
    [ -n "$PGID" ] && kill -TERM -"$PGID" 2>/dev/null
    kill -TERM "$OLD" 2>/dev/null
    for i in $(seq 1 24); do lsof -nP -iTCP:4519 -sTCP:LISTEN -t >/dev/null 2>&1 || break; sleep 0.5; done
    STILL=$(lsof -nP -iTCP:4519 -sTCP:LISTEN -t 2>/dev/null | head -1)
    [ -n "$STILL" ] && { echo "force-killing $STILL"; kill -9 "$STILL" 2>/dev/null; sleep 1; }
  fi
  echo ">>> $(date '+%H:%M:%S') old engine down — booting fresh engine on :4519"
  PORT=4519 OFFICE_PORT=4519 nohup node "$SERVERJS" >> "$DESKTOP/office.out" 2>&1 &
  NEW=$!
  echo "new engine pid=$NEW"
  up=0
  for i in $(seq 1 80); do
    if curl -sf "http://localhost:4519/" >/dev/null 2>&1; then up=1; break; fi
    sleep 0.5
  done
  if [ "$up" = 1 ]; then echo ">>> $(date '+%H:%M:%S') DEV OFFICE BACK UP on http://localhost:4519 (new engine, fix loaded)"; else echo ">>> $(date '+%H:%M:%S') WARN engine not responding yet — check office.out"; fi
} >> "$LOG" 2>&1
