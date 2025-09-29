Param(
  [int]$Port = 8000
)

# Resolve repo root and venv regardless of current working directory
$repoRoot = (Resolve-Path "$PSScriptRoot\..\").Path
$venvPy = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  Write-Host "[run] venv python not found at $venvPy."
  Write-Host "[run] Hint: run scripts/setup_win_311.ps1 to provision .venv"
  # Fallback to system Python 3.11 if available
  try {
    $ver = & py -3.11 -V 2>$null
    if ($ver) {
      Write-Host "[run] Falling back to system py -3.11 ($ver)"
      $venvPy = $null
      $py = "py -3.11"
    } else {
      throw "Python 3.11 not available"
    }
  } catch {
    throw "[run] No venv and no system Python 3.11 found. Please run scripts/setup_win_311.ps1"
  }
} else {
  Write-Host "[run] Using interpreter: $venvPy"
  $py = $venvPy
}

# Kill any process bound to the port (paranoia fix for 10048)
$conns = (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($conns) {
  $owning = $conns.OwningProcess | Sort-Object -Unique
  foreach ($procId in $owning) {
    try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300 } catch {}
  }
}

# If still bound, pick a free fallback port
$tryPort = $Port
while (Get-NetTCPConnection -State Listen -LocalPort $tryPort -ErrorAction SilentlyContinue) {
  $tryPort++
}
if ($tryPort -ne $Port) { Write-Host "[run] Port $Port busy; using $tryPort" }
$env:PORT = "$tryPort"

# Set environment variables
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { 'memory://' }
$env:ALLOW_TIKTOK_ADAPTER = if ($env:ALLOW_TIKTOK_ADAPTER) { $env:ALLOW_TIKTOK_ADAPTER } else { 'true' }
if (-not $env:WHISPER_MODEL) { $env:WHISPER_MODEL = 'tiny' }
if (-not $env:WHISPER_CACHE_DIR) { $env:WHISPER_CACHE_DIR = 'whisper_models_cache' }
# Speed: lower worker poll interval for faster pickup; more fetch concurrency
if (-not $env:WORKER_POLL_INTERVAL_SECONDS) { $env:WORKER_POLL_INTERVAL_SECONDS = '1' }
if (-not $env:MAX_CONCURRENT_FETCHES) { $env:MAX_CONCURRENT_FETCHES = '3' }

Write-Host "[run] Starting server on port $tryPort"
Write-Host "[run] DATABASE_URL=$($env:DATABASE_URL)"
Write-Host "[run] ALLOW_TIKTOK_ADAPTER=$($env:ALLOW_TIKTOK_ADAPTER)"
Write-Host "[run] WHISPER_MODEL=$($env:WHISPER_MODEL)"

# Start Uvicorn ONCE, no reload
if ($py -eq "py -3.11") {
  & py -3.11 -m uvicorn app.api.main:app --host 127.0.0.1 --port $tryPort
} else {
  & $py -m uvicorn app.api.main:app --host 127.0.0.1 --port $tryPort
}
