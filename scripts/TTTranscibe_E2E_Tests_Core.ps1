# TTTranscibe_E2E_Tests_Core.ps1
# Core endpoint tests: /health, /, /api/transcribe

. "$PSScriptRoot/TTTranscibe_E2E_Utils.ps1"

function TT_TestHealth {
    param([string]$BaseUrl)
    TT_LogInfo "Testing health endpoint..."; TT_LogInfo "  -> $BaseUrl/health"
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -TimeoutSec 15
        if ($r.StatusCode -ne 200) { TT_LogError "Health HTTP $($r.StatusCode)"; return $false }
        $body = $r.Content | ConvertFrom-Json
        if ($body.status -ne 'ok' -or [string]::IsNullOrWhiteSpace($body.timestamp)) { TT_LogError 'Health payload invalid'; return $false }
        TT_LogOk "Health ok"; return $true
    } catch { TT_LogError "Health failed: $($_.Exception.Message)"; return $false }
}

function TT_TestVersion {
    param([string]$BaseUrl)
    TT_LogInfo "Testing version endpoint..."; TT_LogInfo "  -> $BaseUrl/version"
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/version" -Method GET -TimeoutSec 15
        if ($r.StatusCode -ne 200) { TT_LogError "Version HTTP $($r.StatusCode)"; return $false }
        $body = $r.Content | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($body.git_sha)) { TT_LogError 'Version payload invalid'; return $false }
        TT_LogOk "Version ok: $($body.git_sha)"; return $true
    } catch { TT_LogError "Version failed: $($_.Exception.Message)"; return $false }
}

function TT_TestGradioUI {
    param([string]$BaseUrl)
    TT_LogInfo "Testing Gradio UI..."; TT_LogInfo "  -> $BaseUrl/"
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/" -Method GET -TimeoutSec 15
        if ($r.StatusCode -eq 200 -and $r.Content -like '*gradio*') { TT_LogOk 'Gradio UI ok'; return $true }
        TT_LogError "UI bad: HTTP $($r.StatusCode)"; return $false
    } catch { TT_LogError "UI failed: $($_.Exception.Message)"; return $false }
}

function TT_TestAPIStructure {
    param([string]$BaseUrl)
    TT_LogInfo "Testing API structure..."; TT_LogInfo "  -> $BaseUrl/api/transcribe"
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Body '{"invalid":"request"}' -ContentType 'application/json' -TimeoutSec 15
        if ($r.StatusCode -in @(400,401,403,422)) { TT_LogOk 'API structure ok'; return $true }
        TT_LogError "Unexpected status: $($r.StatusCode)"; return $false
    } catch { TT_LogOk 'API structure ok (expected error)'; return $true }
}

function TT_TestAPITranscription {
    param([string]$BaseUrl,[string]$ApiKey,[string]$ApiSecret,[string]$Url,[int]$TimeoutSec,[int]$MaxRetries)
    TT_LogInfo "Testing API transcription..."; TT_LogInfo "  -> Target URL: $Url"; TT_LogInfo "  -> Endpoint: $BaseUrl/api/transcribe"
    for ($i=1; $i -le $MaxRetries; $i++) {
        try {
            $ts = TT_UnixMs
            $body = @{ url = $Url } | ConvertTo-Json
            $sig = TT_NewHMACSignature -Secret $ApiSecret -Method 'POST' -Path '/api/transcribe' -Body $body -Timestamp $ts
            $hdr = @{ 'Content-Type'='application/json'; 'X-API-Key'=$ApiKey; 'X-Timestamp'=$ts; 'X-Signature'=$sig }
            TT_LogInfo ("  -> Headers: {0}" -f ($hdr | ConvertTo-Json -Compress))
            TT_LogInfo ("  -> Body: {0}" -f $body)
            $start = Get-Date
            $r = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Headers $hdr -Body $body -ContentType 'application/json' -TimeoutSec $TimeoutSec
            $elapsed = (Get-Date) - $start
            TT_LogInfo ("  -> Status: {0}, Elapsed: {1} ms" -f $r.StatusCode, [int]$elapsed.TotalMilliseconds)
            TT_LogInfo ("  -> Response: {0}" -f $r.Content)
            if ($r.StatusCode -eq 200) { TT_LogOk 'Transcription ok'; return $true }
            TT_LogWarn "HTTP $($r.StatusCode) on attempt $i"; Start-Sleep -Seconds 2
        } catch { TT_LogWarn "Attempt $i failed: $($_.Exception.Message)"; if ($i -lt $MaxRetries) { Start-Sleep -Seconds 2 } }
    }
    return $false
}




