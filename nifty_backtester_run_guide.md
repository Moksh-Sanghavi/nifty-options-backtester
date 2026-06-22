# Nifty Options Backtester — Local Run & Shutdown Guide

## Architecture recap

4 services, 4 terminals, all running **at the same time**:

| # | Service        | Port | What it does                                  |
|---|----------------|------|------------------------------------------------|
| 1 | Redis          | 6379 | Message broker connecting FastAPI ↔ Celery     |
| 2 | FastAPI        | 8000 | The API your frontend talks to                 |
| 3 | Celery worker  | —    | Actually runs the backtests in the background  |
| 4 | Next.js        | 3000 | The UI you see in the browser                  |

---

## One-time setup (only ever needed once, ever)

Check if the dataset is already converted:

```powershell
dir D:\Moksh\Website\backend\data
```

If you see `options_dec2023.parquet` and `spot_dec2023.parquet` → done, skip this forever.

If not:

```powershell
cd D:\Moksh\Website\backend
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m scripts.convert_to_parquet --dataset dec2023
```

---

## 🟢 Starting everything (every session)

### Step 0 — Zombie check

Before opening anything, make sure nothing's already squatting on your ports from last time:

```powershell
netstat -ano | findstr ":6379 :8000 :3000"
```

- **Nothing shows up** → clean, go straight to Terminal 1.
- **Something on 8000 or 3000** → kill it: `taskkill /PID <pid> /F`
- **Something on 6379** → check what it is first: `tasklist /FI "PID eq <pid>"`. If it's `redis-server.exe`, leave it alone — Redis is already alive, **skip Terminal 1 below**.

### Terminal 1 — Redis

```powershell
C:\Users\intern\tools\redis\redis-server.exe
```
✅ Look for: `Ready to accept connections`

### Terminal 2 — FastAPI backend

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd D:\Moksh\Website
backend\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --app-dir backend --host 0.0.0.0 --port 8000
```
✅ Look for: `Application startup complete.`

### Terminal 3 — Celery worker

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd D:\Moksh\Website\backend
.venv\Scripts\Activate.ps1
celery -A app.celery_app.celery worker --loglevel=info --pool=solo
```
✅ Look for: `celery@<your-pc-name> ready.`

### Terminal 4 — Frontend

```powershell
cd D:\Moksh\Website\frontend
npm run dev
```
✅ Look for: `Ready in ___ms` and `Local: http://localhost:3000`

### Final check

Open **http://localhost:3000**, run a test backtest. If it kicks off and shows live progress, you're fully live. API docs live at **http://127.0.0.1:8000/docs**.

---

## 🔴 Shutting everything down

Stop the "consumers" before the "provider" — cleanest order:

1. **Terminal 4 (Frontend)** → click in, `Ctrl + C`
2. **Terminal 3 (Celery)** → `Ctrl + C` (let it finish if mid-task, then it exits)
3. **Terminal 2 (FastAPI)** → `Ctrl + C`
4. **Terminal 1 (Redis)** → `Ctrl + C`
5. Close all 4 terminal windows.

### Verify it's actually dead

Windows doesn't always fully kill these on terminal close (you've seen this firsthand). Open one fresh terminal:

```powershell
netstat -ano | findstr ":6379 :8000 :3000"
```

- **Empty** → everything's properly closed.
- **Still `LISTENING`** → it's a zombie:
  ```powershell
  taskkill /PID <pid> /F
  ```

---

## Quick troubleshooting cheatsheet

| Problem                                          | Fix                                                                                  |
|---------------------------------------------------|---------------------------------------------------------------------------------------|
| "running scripts is disabled" in PowerShell        | Run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first, every new terminal |
| Redis won't bind to 6379                           | Likely already running from before — check with `tasklist /FI "PID eq <pid>"`, leave it if it's `redis-server.exe` |
| Next.js grabs port 3001 instead of 3000            | Something's still on 3000 — `taskkill` it, then `npm run dev` again                   |
| Celery can't find `app.celery_app`                 | Make sure you `cd`'d into `backend` first — Celery resolves that import relative to your folder |
| uvicorn "address already in use" on 8000           | `netstat -ano | findstr :8000`, then `taskkill /PID <pid> /F`                          |
