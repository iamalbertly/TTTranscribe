# TTTranscribe Test Runner
# Simplified test runner with configuration support

param(
    [string]$Scenario = "QuickTest",
    [string]$BaseUrl = "http://localhost:8788",
    [switch]$Verbose = $false
)

# Load .env.local into process environment to provide defaults
function Load-DotEnv {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line) { return }
        if ($line.StartsWith('#')) { return }
        $eqIndex = $line.IndexOf('=')
        if ($eqIndex -lt 1) { return }
        $key = $line.Substring(0, $eqIndex).Trim()
        $val = $line.Substring($eqIndex + 1).Trim()
        if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
        if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
        Set-Item -Path "Env:$key" -Value $val
    }
}

$envFile = Join-Path (Get-Location) 'env.local'
Load-DotEnv -Path $envFile

# Load configuration
$ConfigPath = Join-Path $PSScriptRoot "TTTranscribe-Test-Config.ps1"
if (Test-Path $ConfigPath) {
    $Config = & $ConfigPath
} else {
    Write-Error "Configuration file not found: $ConfigPath"
    exit 1
}

# Override base URL from env/local if provided or use parameter
if ($env:BASE_URL) {
    $Config.API.BaseUrl = $env:BASE_URL
} elseif ($BaseUrl -ne "http://localhost:8788") {
    $Config.API.BaseUrl = $BaseUrl
} elseif ($env:PORT) {
    $Config.API.BaseUrl = "http://localhost:$($env:PORT)"
}

# Override auth secret from env if present
if ($env:ENGINE_SHARED_SECRET) {
    $Config.API.AuthSecret = $env:ENGINE_SHARED_SECRET
}

# Override test URL from env if present
if ($env:TEST_URL) {
    $Config.TestUrls.ValidTikTok = $env:TEST_URL
}

# Get scenario configuration
$ScenarioConfig = $Config.Scenarios.$Scenario
if (-not $ScenarioConfig) {
    Write-Error "Unknown scenario: $Scenario. Available: $($Config.Scenarios.Keys -join ', ')"
    exit 1
}

Write-Host "🧪 Running TTTranscribe Test Scenario: $($ScenarioConfig.Name)" -ForegroundColor Cyan
Write-Host "Duration: $($ScenarioConfig.Duration) seconds" -ForegroundColor Gray
Write-Host "Tests: $($ScenarioConfig.Tests -join ', ')" -ForegroundColor Gray

# Run the main test orchestrator with scenario-specific parameters
$OrchestratorPath = Join-Path $PSScriptRoot "TTTranscribe-E2E-Test-Orchestrator.ps1"

$OrchestratorParams = @{
    BaseUrl = $Config.API.BaseUrl
    AuthSecret = $Config.API.AuthSecret
    TestUrl = $Config.TestUrls.ValidTikTok
    Verbose = $Verbose
}

& $OrchestratorPath @OrchestratorParams
