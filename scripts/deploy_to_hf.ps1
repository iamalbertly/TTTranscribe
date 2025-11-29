param(
  [string]$Owner = "iamromeoly",
  [string]$SpaceName = "TTTranscribe",
  [string]$Branch = "main",
  [switch]$SkipSecrets = $false
)

$ErrorActionPreference = 'Stop'
Write-Host "[deploy_to_hf] Building project before deploy..." -ForegroundColor Cyan

# Ensure node and npm are available
try { & node --version > $null } catch { Write-Error "Node.js is required. Install Node.js and try again."; exit 1 }

# Install dependencies and build
Write-Host "[deploy_to_hf] Installing Node dependencies (npm ci)..." -ForegroundColor Cyan
& npm ci
Write-Host "[deploy_to_hf] Building TypeScript (npm run build)..." -ForegroundColor Cyan
& npm run build

Write-Host "[deploy_to_hf] Running deploy_remote.ps1..." -ForegroundColor Cyan

# Prefer HUGGINGFACE_HUB_TOKEN env var if present
$token = if ($env:HUGGINGFACE_HUB_TOKEN) { $env:HUGGINGFACE_HUB_TOKEN } else { Read-Host -AsSecureString "Enter Hugging Face token (or set HUGGINGFACE_HUB_TOKEN)" | ConvertFrom-SecureString }

# Convert secure string back if necessary
if ($token -is [System.Security.SecureString]) {
  Write-Host "Token provided as SecureString; please set HUGGINGFACE_HUB_TOKEN environment variable for non-interactive usage." -ForegroundColor Yellow
  exit 1
}

$deployScript = Join-Path $PSScriptRoot "deploy_remote.ps1"
if (-not (Test-Path $deployScript)) { Write-Error "deploy_remote.ps1 not found in scripts/"; exit 1 }

# Call deploy_remote with token
& $deployScript -Owner $Owner -SpaceName $SpaceName -Token $token -Branch $Branch -SkipSecrets:$SkipSecrets
