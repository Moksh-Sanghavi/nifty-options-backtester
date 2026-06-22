#!/usr/bin/env bash
# =============================================================================
#  stop-mac.command  -  Shut down every Nifty Options Backtester service (macOS).
#
#  Double-click in Finder, or run:   ./stop-mac.command
#
#  Kills the processes started by start-mac.command (via recorded PIDs), then
#  frees the known ports (3000 / 8000 / 6379) to catch any child processes,
#  then the Celery worker (which holds no port). Safe to run anytime.
# =============================================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
RUNDIR="$ROOT/.run"

echo "Stopping Nifty Options Backtester (macOS)..."

# 1. Kill the processes we recorded at start.
if [ -d "$RUNDIR" ]; then
    for f in "$RUNDIR"/*.pid; do
        [ -e "$f" ] || continue
        pid="$(cat "$f" 2>/dev/null)"
        name="$(basename "$f" .pid)"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null && echo "  -> stopped $name (pid $pid)"
        fi
        rm -f "$f"
    done
fi

# 2. Free the known ports (catches child procs like next/node under npm).
for port in 3000 8000 6379; do
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)"
    for pid in $pids; do
        kill "$pid" 2>/dev/null && echo "  -> freed port $port (pid $pid)"
    done
done

# 3. Celery worker holds no port - kill by command pattern.
if pkill -f 'celery -A app.celery_app' 2>/dev/null; then
    echo "  -> stopped Celery worker"
fi

sleep 1

# 4. Report anything still listening.
still=""
for port in 3000 8000 6379; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then still="$still $port"; fi
done
if [ -n "$still" ]; then
    echo "Still busy on ports:$still  (re-run, or:  lsof -nP -iTCP:<port> -sTCP:LISTEN )"
else
    echo "All services stopped - ports 3000 / 8000 / 6379 are clear."
fi
