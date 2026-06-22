# =============================================================================
#  start-all.ps1  -  Launch the whole Nifty Options Backtester with ONE command.
#
#  Run this from a single PowerShell window:
#       powershell -ExecutionPolicy Bypass -File start-all.ps1
#
#  It opens the 4 services each in its own labelled window (Redis, FastAPI,
#  Celery, Frontend) so you can still see each one's logs, then auto-opens the
#  app in your browser once it's ready. You no longer open/type in 4 terminals
#  yourself - this does it for you.
#
#  To shut everything down later:  powershell -ExecutionPolicy Bypass -File stop-all.ps1
# =============================================================================

$root  = "D:\Moksh\Website"
$redis = "C:\Users\intern\tools\redis\redis-server.exe"

function Test-Port([int]$p) {
    [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

# Helper: open a new PowerShell window (minimised), give it a title, run a
# command, keep it open. -WindowStyle Minimized sends each service straight to
# the taskbar so you don't see the logs - they're still there if you ever need them.
function Start-Service-Window([string]$title, [string]$command) {
    Start-Process powershell -WindowStyle Minimized -ArgumentList @(
        "-NoExit",
        "-Command",
        "`$host.UI.RawUI.WindowTitle='$title'; $command"
    )
    Write-Host "  -> launched $title" -ForegroundColor Green
}

Write-Host "Starting Nifty Options Backtester..." -ForegroundColor Cyan

# 1. Redis (skip if it's already alive on 6379) -------------------------------
if (Test-Port 6379) {
    Write-Host "  -> Redis already running on 6379 (leaving it)." -ForegroundColor DarkGray
} else {
    Start-Service-Window "Redis" "& '$redis'"
}

# 2. FastAPI backend (port 8000) ---------------------------------------------
if (Test-Port 8000) {
    Write-Host "  -> Port 8000 already in use - skipping FastAPI." -ForegroundColor DarkGray
} else {
    Start-Service-Window "FastAPI" `
        "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; cd '$root'; backend\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --app-dir backend --host 0.0.0.0 --port 8000"
}

# 3. Celery worker -----------------------------------------------------------
Start-Service-Window "Celery" `
    "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; cd '$root\backend'; .venv\Scripts\Activate.ps1; celery -A app.celery_app.celery worker --loglevel=info --pool=solo"

# 4. Frontend (port 3000) ----------------------------------------------------
if (Test-Port 3000) {
    Write-Host "  -> Port 3000 already in use - skipping Frontend." -ForegroundColor DarkGray
} else {
    Start-Service-Window "Frontend" "cd '$root\frontend'; npm run dev"
}

# Wait for the frontend to come up, then open the browser --------------------
Write-Host ""
Write-Host "Waiting for the app to be ready (up to ~60s)..." -ForegroundColor Cyan
$ready = $false
foreach ($i in 1..60) {
    Start-Sleep -Seconds 1
    if (Test-Port 3000) { $ready = $true; break }
}

if ($ready) {
    Start-Process "http://localhost:3000"
    Write-Host "All set - opened http://localhost:3000 in your browser." -ForegroundColor Green
} else {
    Write-Host "Frontend didn't report ready yet. Check the 'Frontend' window, then open http://localhost:3000 manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "The 4 service windows are running in the background. Minimise them - don't close them while you work." -ForegroundColor DarkGray
Write-Host "Stop everything with:  powershell -ExecutionPolicy Bypass -File stop-all.ps1" -ForegroundColor DarkGray
