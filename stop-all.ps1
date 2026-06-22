# =============================================================================
#  stop-all.ps1  -  Shut down every Nifty Options Backtester service at once.
#
#  Run:  powershell -ExecutionPolicy Bypass -File stop-all.ps1
#
#  Kills whatever is listening on the app's ports (Redis 6379, FastAPI 8000,
#  Frontend 3000) plus the Celery worker (which doesn't hold a port), then
#  closes the leftover service windows. Safe to run even if some are already
#  stopped.
# =============================================================================

Write-Host "Stopping Nifty Options Backtester services..." -ForegroundColor Cyan

# 1. Kill processes holding the known ports.
foreach ($port in 3000, 8000, 6379) {
    $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        try {
            $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "  -> stopped $name (port $port)" -ForegroundColor Green
        } catch { }
    }
}

# 2. Kill the Celery worker (a python.exe with 'celery' in its command line).
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'celery' } |
    ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            Write-Host "  -> stopped Celery worker (PID $($_.ProcessId))" -ForegroundColor Green
        } catch { }
    }

# 3. Verify the ports are clear.
Start-Sleep -Seconds 1
$still = Get-NetTCPConnection -LocalPort 3000,8000,6379 -State Listen -ErrorAction SilentlyContinue
if ($still) {
    Write-Host "Some ports are still busy:" -ForegroundColor Yellow
    $still | Select-Object LocalPort, OwningProcess | Format-Table -AutoSize
} else {
    Write-Host "All services stopped - ports 3000 / 8000 / 6379 are clear." -ForegroundColor Green
}
