Param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "[setup] Starting Windows 11 Python 3.11 environment setup..."

# Helper: refresh PATH from machine+user (useful after winget installs)
function Refresh-Path {
	$machine = [Environment]::GetEnvironmentVariable('Path','Machine')
	$user = [Environment]::GetEnvironmentVariable('Path','User')
	$env:Path = "$machine;$user"
}

# Helper: locate a Python 3.11 interpreter
function Find-Python311 {
	try { $v = (& py -3.11 -V) 2>$null; if ($v) { return @{ kind='py'; path='py' } } } catch {}
	$common = @(
		"$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
		"$env:ProgramFiles\Python311\python.exe",
		"$env:ProgramFiles(x86)\Python311\python.exe"
	)
	foreach ($p in $common) { if (Test-Path $p) { return @{ kind='exe'; path=$p } } }
	return $null
}

# Ensure Python 3.11 availability
try {
	$pyInfo = Find-Python311
	if (-not $pyInfo) {
		Write-Host "[setup] Python 3.11 not found. Attempting installation via winget..."
		$winget = (Get-Command winget -ErrorAction SilentlyContinue)
		if (-not $winget) { throw "winget not found. Install Python 3.11 from https://www.python.org/downloads/windows/ and re-run." }
		winget install -e --id Python.Python.3.11 -h --accept-source-agreements --accept-package-agreements | Out-Null
		Start-Sleep -Seconds 3
		Refresh-Path
		$pyInfo = Find-Python311
	}
	if (-not $pyInfo) { throw "No suitable Python 3.11 runtime found after install. Please reboot or install from python.org, then re-run." }
	Write-Host "[setup] Detected Python 3.11 via $($pyInfo.kind): $($pyInfo.path)"
}
catch { Write-Host "[setup] Failed to ensure Python 3.11: $($_.Exception.Message)"; exit 1 }

try {
	Write-Host "[setup] Creating virtual environment (.venv) with Python 3.11..."
	if ($pyInfo.kind -eq 'py') { & py -3.11 -m venv .venv } else { & $pyInfo.path -m venv .venv }
	& .\.venv\Scripts\Activate.ps1
	Write-Host "[setup] Python: $(python -V)"
	Write-Host "[setup] Upgrading pip/tooling..."
	python -m pip install --upgrade pip wheel setuptools | Out-Null

	# Clean any broken leftover dists that can confuse Windows imports
	Write-Host "[setup] Cleaning residual packages (torch/numpy/whisper/tiktoken/numba/llvmlite) if present..."
	try { pip uninstall -y torch torchvision torchaudio numpy openai-whisper tiktoken numba llvmlite 2>$null | Out-Null } catch {}
	# Remove stray folders like '~orch*' and numpy artifacts that pip may leave behind
	$siteDir = (& python -c "import site; print(site.getsitepackages()[0])").Trim()
	if (Test-Path $siteDir) {
		Get-ChildItem -Path $siteDir -Filter "~orch*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
		$globs = @('numpy', 'numpy-*', 'numpy.libs', 'tiktoken', 'tiktoken-*', 'numba', 'numba-*', 'llvmlite', 'llvmlite-*')
		foreach ($g in $globs) { Get-ChildItem -Path $siteDir -Filter $g -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
	}

	# Install a stable NumPy wheel first to avoid C-extension issues on Windows
	Write-Host "[setup] Installing stable NumPy (1.26.4) ..."
	pip install --no-cache-dir --force-reinstall numpy==1.26.4

	# Ensure pinned Torch CPU wheel next
	Write-Host "[setup] Ensuring pinned Torch CPU wheel..."
	pip install torch==2.2.2+cpu --index-url https://download.pytorch.org/whl/cpu

	# Install the rest of the stack (includes fastapi/uvicorn/httpx/yt-dlp/whisper)
	Write-Host "[setup] Installing core web dependencies and tools with Windows constraints (Torch CPU)..."
	pip install -r requirements.txt -c constraints.win-py311.txt

	# Reassert NumPy pin in case dependency chain tried to bump it
	Write-Host "[setup] Reasserting NumPy pin ..."
	pip install --no-cache-dir --force-reinstall numpy==1.26.4 | Out-Null

	# Forcing regex wheel and installing python-multipart
	Write-Host "[setup] Forcing regex wheel and installing python-multipart ..."
	pip install --force-reinstall --only-binary=:all: regex==2024.5.15
	pip install python-multipart==0.0.9

	Write-Host "[setup] Installing compatible llvmlite/numba pins ..."
	pip install --no-cache-dir --force-reinstall llvmlite==0.42.0 numba==0.59.1

	Write-Host "[setup] Reinstalling tiktoken as wheel (stable pin) ..."
	pip install --force-reinstall --only-binary=:all: tiktoken==0.6.0

	Write-Host "[setup] Verifying key tools..."
	ffmpeg -version | Select-Object -First 1 | Write-Host
	try { yt-dlp --version | Write-Host } catch { throw "[setup] yt-dlp not available after install" }
	$verify = & python -c "import sys; import regex, tiktoken, torch, whisper; import numpy as np, numba, llvmlite; print('[setup] ok torch='+torch.__version__+' numpy='+np.__version__+' numba='+numba.__version__+' llvmlite='+llvmlite.__version__+' regex='+regex.__version__+' python='+sys.version.split()[0])"
	if ($LASTEXITCODE -ne 0) { throw "verification failed" }
	Write-Host $verify

	Write-Host "[setup] Completed successfully. Activate with .\\.venv\\Scripts\\Activate.ps1"
}
catch {
	Write-Host $_.Exception.Message
	exit 1
}
