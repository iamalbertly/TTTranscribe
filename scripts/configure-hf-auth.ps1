# Script to set the ENGINE_SHARED_SECRET in Hugging Face Spaces
# Usage: .\scripts\configure-hf-auth.ps1 -Secret "your-secret"

param (
    [string]$SpaceId = "iamromeoly/TTTranscibe",
    [string]$SecretKey = "ENGINE_SHARED_SECRET",
    [string]$SecretValue
)

# Try to load from .env.local if not provided
if (-not $SecretValue) {
    $EnvPath = Join-Path $PSScriptRoot "..\.env.local"
    if (Test-Path $EnvPath) {
        $EnvContent = Get-Content $EnvPath
        foreach ($line in $EnvContent) {
            if ($line -match "^ENGINE_SHARED_SECRET=(.*)") {
                $SecretValue = $matches[1].Trim()
                Write-Host "📖 Loaded secret from .env.local" -ForegroundColor Gray
                break
            }
        }
    }
}

if (-not $SecretValue) {
    Write-Error "❌ Secret value not provided and not found in .env.local"
    Write-Host "Usage: .\scripts\configure-hf-auth.ps1 -SecretValue 'your-secret'"
    exit 1
}

Write-Host "🔐 Configuring authentication for Hugging Face Space: $SpaceId" -ForegroundColor Cyan

# Check if huggingface-cli is installed (implies huggingface_hub is installed)
if (-not (Get-Command "huggingface-cli" -ErrorAction SilentlyContinue)) {
    Write-Error "❌ huggingface-cli is not installed or not in PATH."
    Write-Host "👉 Please install it: pip install huggingface-hub"
    exit 1
}

# Run the python script
try {
    $ScriptPath = Join-Path $PSScriptRoot "configure_auth.py"
    python $ScriptPath --space "$SpaceId" --key "$SecretKey" --value "$SecretValue"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Configuration script executed successfully." -ForegroundColor Green
    } else {
        Write-Error "❌ Configuration script failed. Exit code: $LASTEXITCODE"
    }
} catch {
    Write-Error "❌ Error executing command: $_"
}
