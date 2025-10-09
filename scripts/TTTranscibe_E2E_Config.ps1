# TTTranscibe_E2E_Config.ps1
# Provides configuration and defaults for E2E tests.

param(
    [string]$BaseUrl = $env:TTT_BASE_URL, # optional env override
    [string]$ApiKey = $env:TTT_API_KEY,
    [string]$ApiSecret = $env:TTT_API_SECRET,
    [string]$TestUrl = $env:TTT_TEST_URL,
    [int]$TimeoutSeconds = 600,
    [int]$Retries = 1
)

function Get-E2EConfig {
    # Fallback to hardcoded defaults if not provided via env/params
    $cfg = [ordered]@{}
    $cfg.BaseUrl = if (![string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl } else { 'https://iamromeoly-tttranscibe.hf.space' }
    $cfg.ApiKey  = if (![string]::IsNullOrWhiteSpace($ApiKey))  { $ApiKey }  else { 'key_live_89f590e1f8cd3e4b19cfcf14' }
    $cfg.ApiSecret = if (![string]::IsNullOrWhiteSpace($ApiSecret)) { $ApiSecret } else { 'b0b5638935304b247195ff2cece8ed3bb307e1728397fce07bd2158866c73fa6' }
    $cfg.TestUrl = if (![string]::IsNullOrWhiteSpace($TestUrl)) { $TestUrl } else { 'https://vm.tiktok.com/ZMADQVF4e/' }
    $cfg.TimeoutSeconds = if ($TimeoutSeconds -gt 0) { $TimeoutSeconds } else { 600 }
    $cfg.Retries = if ($Retries -gt 0) { $Retries } else { 1 }
    return $cfg
}




