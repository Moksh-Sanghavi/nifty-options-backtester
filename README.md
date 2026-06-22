# Nifty Options Backtester — Full-Stack Web Application

Asynchronous web app wrapping a production-grade Nifty 50 options backtesting
engine (Wall Reversion + Opening Range Breakout strategies).

## Stack

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| Frontend     | Next.js (App Router), React, Tailwind, shadcn/ui, TradingView Lightweight Charts |
| Backend      | FastAPI, Pydantic                                       |
| Async compute| Celery + Redis                                          |
| Data         | Pandas, PyArrow (Parquet)                               |
| Ops          | Docker, Docker Compose                                  |

## Architecture

```
Browser ──HTTP──> FastAPI (backend) ──enqueue──> Redis ──> Celery worker
   ^                   |                                        |
   └──── poll status ──┘                                        |
                       └──────── results stored in Redis <──────┘
```

## Prerequisite — generate the Parquet dataset (once)

The engine reads Parquet, not the raw CSVs. Convert them once:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m scripts.convert_to_parquet --dataset dec2023
```

This writes `backend/data/options_dec2023.parquet` + `spot_dec2023.parquet`
(defaults point at the source CSVs in `D:\Moksh\Options Bakctester`; override
with `--options` / `--spot`). The same files feed both the native and Docker
runs.

## Running natively (no Docker / no admin)

This machine runs the stack natively with portable tooling (Docker requires
admin + WSL2). Portable tools live in `C:\Users\intern\tools\`:

| Tool  | Path                                              |
|-------|---------------------------------------------------|
| Node  | `C:\Users\intern\tools\node-v24.17.0-win-x64\`    |
| Redis | `C:\Users\intern\tools\redis\`                    |

Node is on the user PATH. Start each service in its own terminal:

```powershell
# 1. Redis broker (leave running)
C:\Users\intern\tools\redis\redis-server.exe

# 2. FastAPI API
backend\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --app-dir backend --host 0.0.0.0 --port 8000

# 3. Celery worker
backend\.venv\Scripts\Activate.ps1
celery -A app.celery_app.celery worker --loglevel=info --pool=solo   # run from backend/

# 4. Frontend
cd frontend; npm run dev
```

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs

> `--pool=solo` is used for Celery on Windows (the default prefork pool is
> unsupported there).

## Quick start (Docker — requires Docker Desktop, which needs admin to install)

After generating the Parquet dataset (above), bring the entire stack up with a
single command — no `.env` required (service env vars are baked into the
compose file; copy `.env.example` to `.env` only if you want to override them):

```bash
docker compose up --build
```

This starts Redis, the FastAPI API, the Celery worker, and the Next.js
frontend. Compose waits for Redis and the API healthchecks before starting
dependents.

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs

## Error handling

- Invalid requests (bad date format, `start_date` after `end_date`, out-of-range
  config values, unknown `run_mode`) return **HTTP 422** with a single readable
  `detail` message.
- A missing dataset returns **HTTP 404**; unexpected server errors return a JSON
  **HTTP 500** (never an HTML error page).
- A failed Celery task surfaces via `status` → `FAILURE` with the error message.
- The frontend renders all of these in an error panel + toast, and shows a
  dedicated "no trades generated" state when a valid run produces no executions.

## Project layout

```
backend/    FastAPI app, Celery tasks, refactored quant engine, Parquet converter
frontend/   Next.js application
```

## Build phases — all complete ✅

1. **Repo & environment init** — structure, deps, compose
2. **Backend API & async queue** — engine refactor, Parquet, Celery, FastAPI routes
3. **Frontend scaffolding & state** — layout, config form, polling hook
4. **Visualization & analytics** — tear sheet, equity/drawdown charts, trade log
5. **Error handling & containerization** — graceful errors, finalized Docker setup
