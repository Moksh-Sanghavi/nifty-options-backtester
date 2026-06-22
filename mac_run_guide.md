# Running the Nifty Options Backtester on macOS

Your Windows machine uses `start-all.ps1` / `stop-all.ps1` (PowerShell). On your Mac,
use the equivalent shell scripts in this folder:

- **`start-mac.command`** — launches all 4 services + opens the app
- **`stop-mac.command`** — shuts everything down

They do the same job as the Windows scripts, but with macOS commands
(`bin/activate`, `lsof`, `open`, …). Services run in the background and write logs to
`./logs/` — nothing pops up.

---

## One-time setup (first run on the Mac, after `git clone`)

A clone does **not** include the Python environment, Node modules, or your data —
those are gitignored. Set them up once:

### 1. Install prerequisites (Homebrew)
```bash
brew install redis node python
```

### 2. Python backend environment
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```
> The Windows `.venv` can't be copied over — virtual environments are OS-specific, so
> it must be created fresh on the Mac. (This is also why `.venv/` is gitignored.)

### 3. Frontend dependencies
```bash
cd frontend
npm install
cd ..
```

### 4. Your data  ⚠️ important
The converted Parquet files (`backend/data/*.parquet`) are **gitignored**, so they
won't come through the repo. Get them onto the Mac one of two ways:

- **Copy them over** from your Windows PC — grab
  `D:\Moksh\Website\backend\data\options_*.parquet` and `spot_*.parquet`, and drop
  them into `backend/data/` on the Mac. *(Parquet is cross-platform — same files work
  on both OSes.)* This is the easy path.
- **Or re-convert** from the raw CSVs (if you have them on the Mac):
  ```bash
  cd backend && source .venv/bin/activate
  python -m scripts.convert_to_parquet --dataset dec2023 --options <path.csv> --spot <path.csv>
  ```

### 5. Make the scripts executable (once)
```bash
chmod +x start-mac.command stop-mac.command
```

---

## Every session

**Start:** double-click `start-mac.command` in Finder, or:
```bash
./start-mac.command
```
It checks your setup, starts Redis → FastAPI → Celery → Frontend, waits, and opens
`http://localhost:3000`.

**Stop:** double-click `stop-mac.command`, or:
```bash
./stop-mac.command
```

> **First double-click:** macOS Gatekeeper may say it "cannot verify the developer."
> Right-click the file → **Open** → **Open** (only needed the first time), or run it
> from Terminal as shown above.

---

## Logs & troubleshooting

- Live logs are in `./logs/` — `logs/fastapi.log`, `logs/celery.log`,
  `logs/frontend.log`, `logs/redis.log`. Tail one with e.g. `tail -f logs/celery.log`.
- "No data in backend/data/" on start → see step 4 above.
- Port already in use → `lsof -nP -iTCP:3000 -sTCP:LISTEN` to see who, or just run
  `./stop-mac.command` first.
- Redis missing → `brew install redis`.

---

## Why the two OSes differ (quick reference)

| | Windows | macOS |
|---|---------|-------|
| Shell | PowerShell (`.ps1`) | bash/zsh (`.command`) |
| Activate venv | `backend\.venv\Scripts\Activate.ps1` | `source backend/.venv/bin/activate` |
| Redis | portable `redis-server.exe` | `redis-server` (Homebrew) |
| Open browser | `Start-Process http://...` | `open http://...` |
| Find port owner | `Get-NetTCPConnection` | `lsof` |
| Start / Stop | `start-all.ps1` / `stop-all.ps1` | `start-mac.command` / `stop-mac.command` |

The **application code is identical** on both — only the launch/stop wrappers differ.
