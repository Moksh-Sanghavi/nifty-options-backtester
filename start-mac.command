#!/usr/bin/env bash
# =============================================================================
#  start-mac.command  -  Launch the whole Nifty Options Backtester on macOS.
#
#  Double-click in Finder, or run:   ./start-mac.command
#  (first time only:  chmod +x start-mac.command stop-mac.command)
#
#  Starts all four services in the background (logs go to ./logs/), waits for
#  the app, then opens it in your browser. No windows to manage. Stop it with
#  stop-mac.command.
#
#  FIRST-TIME MAC SETUP (see mac_run_guide.md for detail):
#     brew install redis node python      # prerequisites
#     cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
#     cd ../frontend && npm install
#     # plus: put your options_*.parquet / spot_*.parquet into backend/data/
# =============================================================================

# Resolve the repo root from this script's location (portable - no hard-coded paths).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGDIR="$ROOT/logs"
RUNDIR="$ROOT/.run"
mkdir -p "$LOGDIR" "$RUNDIR"

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# start_bg <name> <shell-command>  -> runs detached, records its PID, logs to file.
start_bg() {
    local name="$1"; local cmd="$2"
    local log="$LOGDIR/$name.log"
    nohup bash -c "$cmd" >"$log" 2>&1 &
    echo $! > "$RUNDIR/$name.pid"
    echo "  -> started $name (pid $(cat "$RUNDIR/$name.pid"))   logs/$name.log"
}

echo "Starting Nifty Options Backtester (macOS)..."

# --- Preflight: fail fast with guidance if the environment isn't set up ------
if [ ! -f "$BACKEND/.venv/bin/activate" ]; then
    echo "!! Python venv missing at backend/.venv"
    echo "   Run once:  cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi
if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "!! frontend/node_modules missing"
    echo "   Run once:  cd frontend && npm install"
    exit 1
fi
if ! ls "$BACKEND"/data/*.parquet >/dev/null 2>&1; then
    echo "!! No data in backend/data/ (parquet files are gitignored, so not in the repo)."
    echo "   Copy options_*.parquet & spot_*.parquet from your Windows PC into backend/data/,"
    echo "   or re-run:  cd backend && python -m scripts.convert_to_parquet --dataset <name> --options <csv> --spot <csv>"
    echo "   (continuing - services will start, but backtests need data)"
fi

# --- 1. Redis (skip if already running on 6379) ------------------------------
if port_in_use 6379; then
    echo "  -> Redis already running on 6379 (leaving it)"
elif command -v redis-server >/dev/null 2>&1; then
    start_bg "redis" "exec redis-server"
else
    echo "  !! redis-server not found - install it:  brew install redis"
fi

# --- 2. FastAPI backend (port 8000) ------------------------------------------
if port_in_use 8000; then
    echo "  -> Port 8000 already in use - skipping FastAPI"
else
    start_bg "fastapi" "cd '$ROOT' && source backend/.venv/bin/activate && exec uvicorn app.main:app --reload --app-dir backend --host 0.0.0.0 --port 8000"
fi

# --- 3. Celery worker --------------------------------------------------------
start_bg "celery" "cd '$BACKEND' && source .venv/bin/activate && exec celery -A app.celery_app.celery worker --loglevel=info --pool=solo"

# --- 4. Frontend (port 3000) -------------------------------------------------
if port_in_use 3000; then
    echo "  -> Port 3000 already in use - skipping Frontend"
else
    start_bg "frontend" "cd '$FRONTEND' && exec npm run dev"
fi

# --- Wait for the app, then open the browser ---------------------------------
echo ""
echo "Waiting for the app to be ready (up to ~60s)..."
ready=0
for _ in $(seq 1 60); do
    if port_in_use 3000; then ready=1; break; fi
    sleep 1
done

if [ "$ready" = "1" ]; then
    open "http://localhost:3000"
    echo "All set - opened http://localhost:3000"
else
    echo "Frontend not ready yet. Check logs/frontend.log, then open http://localhost:3000 manually."
fi

echo ""
echo "Services run in the background. View logs in ./logs/. Stop everything with ./stop-mac.command"
