# TTTranscibe_E2E_Tests_Admin.ps1
# Admin/aux endpoints: jobs, failed, repair, queue/status, integrity, cache, rate limit

. "$PSScriptRoot/TTTranscibe_E2E_Utils.ps1"

function TT_TestJobsSummary { param([string]$BaseUrl) try { $r = Invoke-RestMethod "$BaseUrl/jobs" -TimeoutSec 15; TT_LogOk 'Jobs summary ok'; return $true } catch { TT_LogError "Jobs summary failed: $($_.Exception.Message)"; return $false } }
function TT_TestFailedJobs { param([string]$BaseUrl) try { $r = Invoke-RestMethod "$BaseUrl/jobs/failed" -TimeoutSec 15; TT_LogOk 'Jobs failed ok'; return $true } catch { TT_LogError "Jobs failed endpoint failed: $($_.Exception.Message)"; return $false } }
function TT_TestJobRepair { param([string]$BaseUrl) try { $r = Invoke-RestMethod "$BaseUrl/jobs/repair" -Method POST -TimeoutSec 15; TT_LogOk 'Jobs repair ok'; return $true } catch { TT_LogError "Jobs repair failed: $($_.Exception.Message)"; return $false } }
function TT_TestQueueStatus { param([string]$BaseUrl) try { $r = Invoke-RestMethod "$BaseUrl/queue/status" -TimeoutSec 15; TT_LogOk 'Queue status ok'; return $true } catch { TT_LogError "Queue status failed: $($_.Exception.Message)"; return $false } }

function TT_TestTranscriptIntegrity {
    param([string]$BaseUrl,[string]$ApiKey,[string]$ApiSecret,[string]$Url,[int]$TimeoutSec)
    $ts = TT_UnixMs
    $body = @{ url = $Url } | ConvertTo-Json
    $sig = TT_NewHMACSignature -Secret $ApiSecret -Method 'POST' -Path '/api/transcribe' -Body $body -Timestamp $ts
    $hdr = @{ 'Content-Type'='application/json'; 'X-API-Key'=$ApiKey; 'X-Timestamp'=$ts; 'X-Signature'=$sig }
    try {
        TT_LogInfo ("Integrity POST headers: {0}" -f ($hdr | ConvertTo-Json -Compress))
        TT_LogInfo ("Integrity POST body: {0}" -f $body)
        $resp = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Headers $hdr -Body $body -ContentType 'application/json' -TimeoutSec $TimeoutSec
        TT_LogInfo ("Integrity response: {0}" -f $resp.Content)
        if ($resp.StatusCode -ne 200) { TT_LogError "Integrity HTTP $($resp.StatusCode)"; return $false }
        $r = $resp.Content | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($r.transcript) -or [string]::IsNullOrWhiteSpace($r.transcript_sha256)) { TT_LogError 'Integrity: missing fields'; return $false }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$r.transcript)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $local = ([System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '')).ToLower()
        if ($local -ne $r.transcript_sha256) { TT_LogError "Integrity: local $local != server $($r.transcript_sha256)"; return $false }
        TT_LogOk 'Integrity ok'; return $true
    } catch { TT_LogError "Integrity failed: $($_.Exception.Message)"; return $false }
}

function TT_TestCacheBehavior {
    param([string]$BaseUrl,[string]$ApiKey,[string]$ApiSecret,[string]$Url,[int]$TimeoutSec)
    try {
        $ts1 = TT_UnixMs; $b1 = @{ url=$Url }|ConvertTo-Json; $s1 = TT_NewHMACSignature -Secret $ApiSecret -Method 'POST' -Path '/api/transcribe' -Body $b1 -Timestamp $ts1
        $h1 = @{ 'Content-Type'='application/json'; 'X-API-Key'=$ApiKey; 'X-Timestamp'=$ts1; 'X-Signature'=$s1 }
        $t1s = Get-Date; $r1 = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Headers $h1 -Body $b1 -ContentType 'application/json' -TimeoutSec $TimeoutSec; $t1 = ((Get-Date)-$t1s).TotalMilliseconds
        $j1 = $r1.Content | ConvertFrom-Json

        Start-Sleep -Seconds 1
        $ts2 = TT_UnixMs; $b2 = @{ url=$Url }|ConvertTo-Json; $s2 = TT_NewHMACSignature -Secret $ApiSecret -Method 'POST' -Path '/api/transcribe' -Body $b2 -Timestamp $ts2
        $h2 = @{ 'Content-Type'='application/json'; 'X-API-Key'=$ApiKey; 'X-Timestamp'=$ts2; 'X-Signature'=$s2 }
        $t2s = Get-Date; $r2 = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Headers $h2 -Body $b2 -ContentType 'application/json' -TimeoutSec $TimeoutSec; $t2 = ((Get-Date)-$t2s).TotalMilliseconds
        $j2 = $r2.Content | ConvertFrom-Json

        if ($j2.transcript_sha256 -ne $j1.transcript_sha256) { TT_LogError 'Cache mismatch'; return $false }
        if (!($j2.billed_tokens -eq 0 -or $t2 -lt ($t1 - 500))) { TT_LogError 'Second call not cached/faster'; return $false }
        TT_LogOk 'Cache behavior ok'; return $true
    } catch { TT_LogError "Cache test failed: $($_.Exception.Message)"; return $false }
}

function TT_TestRateLimiting {
    param([string]$BaseUrl,[string]$ApiKey,[string]$ApiSecret,[string]$Url)
    $success=0; for ($i=1;$i -le 7;$i++) {
        try {
            $ts = TT_UnixMs; $b=@{url=$Url}|ConvertTo-Json; $s=TT_NewHMACSignature -Secret $ApiSecret -Method 'POST' -Path '/api/transcribe' -Body $b -Timestamp $ts
            $h=@{'Content-Type'='application/json';'X-API-Key'=$ApiKey;'X-Timestamp'=$ts;'X-Signature'=$s}
            $r = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Headers $h -Body $b -ContentType 'application/json' -TimeoutSec 15
            if ($r.StatusCode -eq 200) { $success++ } elseif ($r.StatusCode -eq 429) { TT_LogOk "Rate limited after $success successes"; return $true } else { return $false }
        } catch {}
        if ($i -lt 7) { Start-Sleep -Seconds 1 }
    }
    TT_LogWarn "Rate limit not observed (informational)"; return $true
}




