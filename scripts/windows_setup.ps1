Param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "Installing prerequisites via winget (Python 3.11, Git, FFmpeg)..."
winget install -e --id Python.Python.3.11 -h --accept-source-agreements --accept-package-agreements | Out-Null
winget install -e --id Git.Git -h --accept-source-agreements --accept-package-agreements | Out-Null
winget install -e --id Gyan.FFmpeg -h --accept-source-agreements --accept-package-agreements | Out-Null

Write-Host "Verifying ffmpeg and yt-dlp availability..."
ffmpeg -version | Select-Object -First 1 | Write-Host
try { yt-dlp --version | Write-Host } catch { Write-Host "yt-dlp not found. Install with: pip install yt-dlp" }

Write-Host "Creating virtual environment..."
python -m venv .venv
& .\.venv\Scripts\Activate.ps1

Write-Host "Installing requirements..."
pip install -r requirements.txt

Write-Host "No database configuration needed - the app uses simple synchronous processing."


