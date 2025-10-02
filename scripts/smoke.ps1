#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

& .\.venv\Scripts\Activate.ps1

# Fast-start env for local smoke
# No database needed for simple app
$env:ENVIRONMENT = 'development'
$env:WHISPER_MODEL = 'tiny'
$env:WHISPER_CACHE_DIR = "$PWD\whisper_models_cache"
# No CORS or adapter settings needed for simple app

# Start with explicit venv python to avoid PATH issues
$proc = Start-Process powershell -ArgumentList "-NoProfile -Command .\\.venv\\Scripts\\python.exe main.py" -PassThru

# Wait until server is ready (max 90s)
$deadlineWait = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 1
  try {
    $null = Invoke-RestMethod -Uri http://127.0.0.1:7860 -Method GET -TimeoutSec 3 -SkipHttpErrorCheck
    $serverUp = $true
  } catch { $serverUp = $false }
} while (-not $serverUp -and (Get-Date) -lt $deadlineWait)
if (-not $serverUp) { throw "Server did not start in time" }

try {
  # Test that the Gradio app is running
  $response = Invoke-RestMethod -Uri http://127.0.0.1:7860 -Method GET -TimeoutSec 10
  Write-Host "SUCCESS: Gradio app is running on port 7860"
  Write-Host "Open http://127.0.0.1:7860 in your browser to test the transcription feature"
  Write-Host "Enter a TikTok URL and click 'Transcribe' to test the full pipeline"
} catch {
  Write-Host "FAILED: $($_.Exception.Message)"
  Write-Host "Make sure the app is running with: python main.py"
  exit 1
} finally {
  if ($proc -and -not $proc.HasExited) {
    $proc.Kill()
    $proc.WaitForExit(5000)
  }
}