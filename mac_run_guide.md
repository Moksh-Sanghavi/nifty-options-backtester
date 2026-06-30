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

### 4. Make the scripts executable (once)
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
- Port already in use → `lsof -nP -iTCP:3000 -sTCP:LISTEN` to see who, or just run
  `./stop-mac.command` first.
- Redis missing → `brew install redis`.

---

The **application code is identical** on both — only the launch/stop wrappers differ.
