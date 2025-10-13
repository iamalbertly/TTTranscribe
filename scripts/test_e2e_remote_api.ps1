#!/usr/bin/env pwsh
<#!
.SYNOPSIS
    Thin wrapper for TTTranscibe E2E tests (modular), under 300 lines.
.NOTES
    Uses scripts with prefix TTTranscribe_E2E_*
#>

param(
    [string]$BaseUrl,
    [string]$ApiKey,
    [string]$ApiSecret,
    [string]$TestUrl,
    [int]$TimeoutSeconds = 600,
    [int]$Retries = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/TTTranscribe_E2E_Config.ps1"
. "$PSScriptRoot/TTTranscribe_E2E_Utils.ps1"
. "$PSScriptRoot/TTTranscribe_E2E_Tests_Core.ps1"
. "$PSScriptRoot/TTTranscribe_E2E_Tests_Admin.ps1"

$cfg = Get-E2EConfig -BaseUrl $BaseUrl -ApiKey $ApiKey -ApiSecret $ApiSecret -TestUrl $TestUrl -TimeoutSeconds $TimeoutSeconds -Retries $Retries

TT_LogInfo "TTTranscribe Remote API E2E Test"; TT_LogInfo "=================================="
TT_LogInfo "Base URL: $($cfg.BaseUrl)"; TT_LogInfo "Test URL: $($cfg.TestUrl)"; TT_LogInfo "Timeout: $($cfg.TimeoutSeconds)"; TT_LogInfo "Retries: $($cfg.Retries)"

$results = [ordered]@{}
$results.Health           = (TT_TestHealth -BaseUrl $cfg.BaseUrl);        if (-not $results.Health) { TT_LogError 'Fail: Health'; exit 1 }
$results.Version          = (TT_TestVersion -BaseUrl $cfg.BaseUrl);       if (-not $results.Version) { TT_LogError 'Fail: Version'; exit 1 }
$results.GradioUI         = (TT_TestGradioUI -BaseUrl $cfg.BaseUrl)
$results.APIStructure     = (TT_TestAPIStructure -BaseUrl $cfg.BaseUrl);  if (-not $results.APIStructure) { TT_LogError 'Fail: APIStructure'; exit 1 }
$results.JobRepair        = (TT_TestJobRepair -BaseUrl $cfg.BaseUrl);     if (-not $results.JobRepair) { TT_LogError 'Fail: JobRepair'; exit 1 }
$results.APITranscription = (TT_TestAPITranscription -BaseUrl $cfg.BaseUrl -ApiKey $cfg.ApiKey -ApiSecret $cfg.ApiSecret -Url $cfg.TestUrl -TimeoutSec $cfg.TimeoutSeconds -MaxRetries $cfg.Retries)
$results.CacheBehavior    = (TT_TestCacheBehavior -BaseUrl $cfg.BaseUrl -ApiKey $cfg.ApiKey -ApiSecret $cfg.ApiSecret -Url $cfg.TestUrl -TimeoutSec $cfg.TimeoutSeconds); if (-not $results.CacheBehavior) { TT_LogError 'Fail: CacheBehavior'; exit 1 }
$results.RateLimiting     = (TT_TestRateLimiting -BaseUrl $cfg.BaseUrl -ApiKey $cfg.ApiKey -ApiSecret $cfg.ApiSecret -Url $cfg.TestUrl)
$results.JobsSummary      = (TT_TestJobsSummary -BaseUrl $cfg.BaseUrl);    if (-not $results.JobsSummary) { TT_LogError 'Fail: JobsSummary'; exit 1 }
$results.FailedJobs       = (TT_TestFailedJobs -BaseUrl $cfg.BaseUrl);     if (-not $results.FailedJobs) { TT_LogError 'Fail: FailedJobs'; exit 1 }
$results.QueueStatus      = (TT_TestQueueStatus -BaseUrl $cfg.BaseUrl);    if (-not $results.QueueStatus) { TT_LogError 'Fail: QueueStatus'; exit 1 }
$results.Integrity        = (TT_TestTranscriptIntegrity -BaseUrl $cfg.BaseUrl -ApiKey $cfg.ApiKey -ApiSecret $cfg.ApiSecret -Url $cfg.TestUrl -TimeoutSec $cfg.TimeoutSeconds)

$passed = @($results.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { $_.Key })
$failed = @($results.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })

TT_LogInfo "\nTest Summary"; TT_LogInfo "==============="
TT_LogInfo ("Passed: {0} / {1}" -f $passed.Count, $results.Count)
if ($failed.Count -gt 0) { TT_LogError ("Failed: {0}" -f ($failed -join ', ')) }

if ($passed.Count -eq $results.Count) { TT_LogOk "ALL TESTS PASSED!"; exit 0 } else { exit 1 }


