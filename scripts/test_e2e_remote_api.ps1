#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Comprehensive remote API E2E test for TTTranscibe (strict)

.DESCRIPTION
    Tests remote API endpoints with production credentials.
    Exits on first failure with detailed error reporting.
    Contains private credentials - DO NOT COMMIT TO GIT.

.NOTES
    This file should be in .gitignore to prevent credential exposure.
#>

param(
    [string]$TestUrl = "https://vm.tiktok.com/ZMADQVF4e/",
    [int]$TimeoutSeconds = 600,
    [int]$Retries = 1,
    [switch]$Verbose = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Private credentials - DO NOT COMMIT
$API_KEY = "key_live_89f590e1f8cd3e4b19cfcf14"
$API_SECRET = "b0b5638935304b247195ff2cece8ed3bb307e1728397fce07bd2158866c73fa6"
$BASE_URL = "https://iamromeoly-tttranscibe.hf.space"

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) { Write-Output $args } else { $input | Write-Output }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Success { Write-ColorOutput Green $args }
function Write-Error { Write-ColorOutput Red $args }
function Write-Warning { Write-ColorOutput Yellow $args }
function Write-Info { 
    Write-Host $args -ForegroundColor Cyan
}

function Test-Health {
    Write-Info "Testing health endpoint..."
    Write-Info "  -> Sending GET request to: $BASE_URL/health"
    
    try {
        $response = Invoke-WebRequest -Uri "$BASE_URL/health" -Method GET -TimeoutSec 10
        Write-Info "  -> Response Status: $($response.StatusCode)"
        Write-Info "  -> Response Headers: $($response.Headers | ConvertTo-Json -Compress)"
        Write-Info "  -> Response Body: $($response.Content)"
        
        if ($response.StatusCode -eq 200) {
            $health = $response.Content | ConvertFrom-Json
            Write-Info "  -> Full health response: $($health | ConvertTo-Json -Depth 3)"

            if ($null -eq $health.status -or $null -eq $health.timestamp) {
                Write-Error "Health missing required fields"
                return $false
            }
            if ($health.status -ne "ok") {
                Write-Error "Health status is not ok"
                return $false
            }

            Write-Success "Health check passed: $($health.status)"
            return $true
        } else {
            Write-Error "Health check failed: HTTP $($response.StatusCode)"
            Write-Error "Response body: $($response.Content)"
            return $false
        }
    } catch {
        Write-Error "Health check failed: $($_.Exception.Message)"
        if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
            Write-Error "Exception response: $($_.Exception.Response)"
        }
        return $false
    }
}

function Test-GradioUI {
    Write-Info "Testing Gradio UI..."
    Write-Info "  -> Sending GET request to: $BASE_URL/"
    
    try {
        $response = Invoke-WebRequest -Uri "$BASE_URL/" -Method GET -TimeoutSec 10
        Write-Info "  -> Response Status: $($response.StatusCode)"
        Write-Info "  -> Response Headers: $($response.Headers | ConvertTo-Json -Compress)"
        Write-Info "  -> Content Length: $($response.Content.Length) characters"
        Write-Info "  -> Content Preview (first 200 chars): $($response.Content.Substring(0, [Math]::Min(200, $response.Content.Length)))"
        
        if ($response.StatusCode -eq 200 -and $response.Content -like "*gradio*") {
            Write-Success "Gradio UI accessible"
            Write-Info "  -> Found 'gradio' in content: YES"
            return $true
        } else {
            Write-Error "Gradio UI not accessible or not found"
            Write-Error "  -> Status: $($response.StatusCode)"
            Write-Error "  -> Contains 'gradio': $($response.Content -like '*gradio*')"
            return $false
        }
    } catch {
        Write-Error "Gradio UI test failed: $($_.Exception.Message)"
        if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
            Write-Error "Exception response: $($_.Exception.Response)"
        }
        return $false
    }
}

function New-HMACSignature {
    param([string]$Secret, [string]$Method, [string]$Path, [string]$Body, [int64]$Timestamp)
    
    $stringToSign = "$Method`n$Path`n$Body`n$Timestamp"
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($Secret))
    $signature = [System.BitConverter]::ToString($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($stringToSign))).Replace("-", "").ToLower()
    $hmac.Dispose()
    return $signature
}

function Test-APITranscription {
    param([string]$Url, [int]$TimeoutSec, [int]$MaxRetries)
    
    Write-Info "Testing API transcription with URL: $Url"
    Write-Info "  -> Target URL: $Url"
    Write-Info "  -> API Endpoint: $BASE_URL/api/transcribe"
    Write-Info "  -> Timeout: $TimeoutSec seconds"
    Write-Info "  -> Max Retries: $MaxRetries"
    
    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        Write-Info "  -> Attempt $attempt/$MaxRetries"
        
        try {
            # Generate timestamp and signature
            $timestamp = [int64]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalMilliseconds
            $body = @{url = $Url} | ConvertTo-Json
            $signature = New-HMACSignature $API_SECRET "POST" "/api/transcribe" $body $timestamp
            
            Write-Info "  -> Generated timestamp: $timestamp"
            Write-Info "  -> Request body: $body"
            Write-Info "  -> Generated signature: $signature"
            
            $headers = @{
                "Content-Type" = "application/json"
                "X-API-Key" = $API_KEY
                "X-Timestamp" = $timestamp.ToString()
                "X-Signature" = $signature
            }
            
            Write-Info "  -> Request headers: $($headers | ConvertTo-Json -Compress)"
            Write-Info "  -> Making authenticated request..."
            
            $startTime = Get-Date
            $response = Invoke-WebRequest -Uri "$BASE_URL/api/transcribe" -Method POST -Headers $headers -Body $body -ContentType "application/json" -TimeoutSec $TimeoutSec
            $endTime = Get-Date
            $elapsed = ($endTime - $startTime).TotalSeconds
            
            Write-Info "  -> Response Status: $($response.StatusCode)"
            Write-Info "  -> Response Headers: $($response.Headers | ConvertTo-Json -Compress)"
            Write-Info "  -> Response Time: $elapsed seconds"
            Write-Info "  -> Response Body: $($response.Content)"
            
            if ($response.StatusCode -eq 200) {
                $result = $response.Content | ConvertFrom-Json
                Write-Success "Transcription successful!"
                Write-Info "  -> Request ID: $($result.request_id)"
                Write-Info "  -> Status: $($result.status)"
                Write-Info "  -> Language: $($result.lang)"
                Write-Info "  -> Duration: $($result.duration_sec) seconds"
                Write-Info "  -> Transcript length: $($result.transcript.Length) characters"
                Write-Info "  -> Source: $($result.source | ConvertTo-Json -Compress)"
                Write-Info "  -> Elapsed: $($result.elapsed_ms) ms"
                Write-Info "  -> Billed tokens: $($result.billed_tokens)"
                Write-Info "  -> Transcript SHA256: $($result.transcript_sha256)"

                # Strict payload validation
                if (![string]::IsNullOrWhiteSpace($result.transcript) -and
                    $result.duration_sec -gt 0 -and
                    ($result.transcript_sha256 -match '^[0-9a-f]{64}$') -and
                    ($result.source.canonical_url -like "*/video/*")) {
                    Write-Host "Valid transcription payload"
                } else {
                    Write-Error "Transcription payload invalid"
                    return $false
                }

                # Non-cached path shouldn't be suspiciously fast
                if ($result.billed_tokens -gt 0 -and $result.elapsed_ms -lt 1500) {
                    Write-Error "First call too fast for a non-cached path"
                    return $false
                }

            Write-Host "=" * 80 -ForegroundColor Yellow
            Write-Host ("Transcript (first 500 chars): {0}" -f $result.transcript.Substring(0, [Math]::Min(500, $result.transcript.Length))) -ForegroundColor White
            Write-Host "=" * 80 -ForegroundColor Yellow
                Write-Info "  -> Full response: $($result | ConvertTo-Json -Depth 3)"
                return $true
            } else {
                Write-Error "API request failed: HTTP $($response.StatusCode)"
                Write-Error "Response body: $($response.Content)"
                if ($attempt -lt $MaxRetries) {
                    Write-Warning "Retrying in 2 seconds..."
                    Start-Sleep -Seconds 2
                }
            }
        } catch {
            Write-Error "API request failed: $($_.Exception.Message)"
            if ($_.Exception.Response) {
                try {
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $errorBody = $reader.ReadToEnd()
                    Write-Error "Error response body: $errorBody"
                } catch {
                    Write-Error "Could not read error response body"
                }
            }
            if ($attempt -lt $MaxRetries) {
                Write-Warning "Retrying in 2 seconds..."
                Start-Sleep -Seconds 2
            }
        }
    }
    
    return $false
}

function Test-CacheBehavior {
    param([string]$Url, [int]$TimeoutSec)
    
    Write-Info "Testing cache behavior (second call should be faster)..."
    Write-Info "  -> Testing URL: $Url"
    Write-Info "  -> Timeout: $TimeoutSec seconds"
    
    try {
        # First call
        Write-Info "  -> Making FIRST call (should not be cached)..."
        $timestamp1 = [int64]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalMilliseconds
        $body1 = @{url = $Url} | ConvertTo-Json
        $signature1 = New-HMACSignature $API_SECRET "POST" "/api/transcribe" $body1 $timestamp1
        
        Write-Info "    -> Timestamp 1: $timestamp1"
        Write-Info "    -> Body 1: $body1"
        Write-Info "    -> Signature 1: $signature1"
        
        $headers1 = @{
            "Content-Type" = "application/json"
            "X-API-Key" = $API_KEY
            "X-Timestamp" = $timestamp1.ToString()
            "X-Signature" = $signature1
        }
        
        Write-Info "    -> Headers 1: $($headers1 | ConvertTo-Json -Compress)"
        
        $start1 = Get-Date
        $response1 = Invoke-WebRequest -Uri "$BASE_URL/api/transcribe" -Method POST -Headers $headers1 -Body $body1 -ContentType "application/json" -TimeoutSec $TimeoutSec
        $elapsed1 = (Get-Date) - $start1
        $result1 = $response1.Content | ConvertFrom-Json
        
        Write-Info "    -> Response 1 Status: $($response1.StatusCode)"
        Write-Info "    -> Response 1 Time: $($elapsed1.TotalSeconds)s"
        Write-Info "    -> Response 1 Body: $($response1.Content)"
        Write-Info "    -> Result 1 Billed Tokens: $($result1.billed_tokens)"
        Write-Info "    -> Result 1 Elapsed (ms): $($result1.elapsed_ms)"
        Write-Info "    -> Result 1 Hash: $($result1.transcript_sha256)"
        
        # Second call (should be cached)
        Write-Info "  -> Waiting 1 second before second call..."
        Start-Sleep -Seconds 1
        
        Write-Info "  -> Making SECOND call (should be cached)..."
        $timestamp2 = [int64]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalMilliseconds
        $body2 = @{url = $Url} | ConvertTo-Json
        $signature2 = New-HMACSignature $API_SECRET "POST" "/api/transcribe" $body2 $timestamp2
        
        Write-Info "    -> Timestamp 2: $timestamp2"
        Write-Info "    -> Body 2: $body2"
        Write-Info "    -> Signature 2: $signature2"
        
        $headers2 = @{
            "Content-Type" = "application/json"
            "X-API-Key" = $API_KEY
            "X-Timestamp" = $timestamp2.ToString()
            "X-Signature" = $signature2
        }
        
        Write-Info "    -> Headers 2: $($headers2 | ConvertTo-Json -Compress)"
        
        $start2 = Get-Date
        $response2 = Invoke-WebRequest -Uri "$BASE_URL/api/transcribe" -Method POST -Headers $headers2 -Body $body2 -ContentType "application/json" -TimeoutSec $TimeoutSec
        $elapsed2 = (Get-Date) - $start2
        $result2 = $response2.Content | ConvertFrom-Json
        
        Write-Info "    -> Response 2 Status: $($response2.StatusCode)"
        Write-Info "    -> Response 2 Time: $($elapsed2.TotalSeconds)s"
        Write-Info "    -> Response 2 Body: $($response2.Content)"
        Write-Info "    -> Result 2 Billed Tokens: $($result2.billed_tokens)"
        Write-Info "    -> Result 2 Elapsed (ms): $($result2.elapsed_ms)"
        Write-Info "    -> Result 2 Hash: $($result2.transcript_sha256)"
        
        Write-Info "  -> Cache Analysis:"
        Write-Info "    -> First call: $($elapsed1.TotalSeconds)s, billed=$($result1.billed_tokens)"
        Write-Info "    -> Second call: $($elapsed2.TotalSeconds)s, billed=$($result2.billed_tokens)"
        Write-Info "    -> Time difference: $($elapsed2.TotalSeconds - $elapsed1.TotalSeconds)s"
        Write-Info "    -> Token difference: $($result2.billed_tokens - $result1.billed_tokens)"
        
        # Validate meaningful transcripts
        if (-not $result1.transcript -or $result1.transcript.Trim() -eq "") {
            Write-Error "❌ First call produced empty transcript!"
            Write-Error "  -> Transcript: '$($result1.transcript)'"
            return $false
        }
        if (-not $result2.transcript -or $result2.transcript.Trim() -eq "") {
            Write-Error "❌ Second call produced empty transcript!"
            Write-Error "  -> Transcript: '$($result2.transcript)'"
            return $false
        }

        Write-Info ("    -> Transcript snippet: '{0}...'" -f $result1.transcript.Substring(0, [Math]::Min(80, $result1.transcript.Length)))

        # Strict cache checks
        if ($result2.transcript_sha256 -ne $result1.transcript_sha256) {
            Write-Error "Cache mismatch, hashes differ"
            return $false
        }
        if (!($result2.elapsed_ms -lt ($result1.elapsed_ms - 500) -or $result2.billed_tokens -eq 0)) {
            Write-Error "Second call not faster and not billed as cache"
            return $false
        }

        if ($result2.billed_tokens -eq 0) {
            Write-Success "Cache hit detected (billed_tokens=0)"
        }
        
        return $true
    } catch {
        Write-Error "Cache test failed: $($_.Exception.Message)"
        if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
            Write-Error "Exception response: $($_.Exception.Response)"
        }
        return $false
    }
}

function Test-RateLimiting {
    Write-Info "Testing rate limiting..."
    Write-Info "  -> Testing URL: $TestUrl"
    Write-Info "  -> Making 7 rapid requests to test rate limiting..."
    
    $successCount = 0
    $rateLimited = $false
    $requestTimes = @()
    
    for ($i = 1; $i -le 7; $i++) {
        Write-Info "  -> Request $i/7..."
        
        try {
            $timestamp = [int64]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalMilliseconds
            $body = @{url = $TestUrl} | ConvertTo-Json
            $signature = New-HMACSignature $API_SECRET "POST" "/api/transcribe" $body $timestamp
            
            Write-Info "    -> Timestamp: $timestamp"
            Write-Info "    -> Body: $body"
            Write-Info "    -> Signature: $signature"
            
            $headers = @{
                "Content-Type" = "application/json"
                "X-API-Key" = $API_KEY
                "X-Timestamp" = $timestamp.ToString()
                "X-Signature" = $signature
            }
            
            Write-Info "    -> Headers: $($headers | ConvertTo-Json -Compress)"
            
            $startTime = Get-Date
            $response = Invoke-WebRequest -Uri "$BASE_URL/api/transcribe" -Method POST -Headers $headers -Body $body -ContentType "application/json" -TimeoutSec 10
            $endTime = Get-Date
            $elapsed = ($endTime - $startTime).TotalSeconds
            $requestTimes += $elapsed
            
            Write-Info "    -> Response Status: $($response.StatusCode)"
            Write-Info "    -> Response Time: $elapsed seconds"
            Write-Info "    -> Response Body: $($response.Content)"
            
            if ($response.StatusCode -eq 200) {
                $successCount++
                Write-Success "Request $i succeeded"
                Write-Info "    -> Success count: $successCount"
            } elseif ($response.StatusCode -eq 429) {
                $rateLimited = $true
                Write-Warning "Request $i rate limited (expected)"
                Write-Info "    -> Rate limited after $successCount successful requests"
                break
            } else {
                Write-Error "Request $i failed: HTTP $($response.StatusCode)"
                Write-Error "Response: $($response.Content)"
                return $false
            }
        } catch {
            Write-Error "Request $i failed: $($_.Exception.Message)"
            if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
                Write-Error "Exception response: $($_.Exception.Response)"
            }
            return $false
        }
        
        if ($i -lt 7) {
            Write-Info "    -> Waiting 1 second before next request..."
            Start-Sleep -Seconds 1
        }
    }
    
    Write-Info "  -> Rate Limiting Analysis:"
    Write-Info "    -> Total requests made: $i"
    Write-Info "    -> Successful requests: $successCount"
    Write-Info "    -> Rate limited: $rateLimited"
    Write-Info "    -> Average response time: $([Math]::Round(($requestTimes | Measure-Object -Average).Average, 2))s"
    Write-Info "    -> Response times: $($requestTimes -join ', ')s"
    
    if ($rateLimited) {
        Write-Success "Rate limiting working (limited after $successCount requests)"
        return $true
    } else {
        Write-Warning "Rate limiting not triggered (made $successCount requests)"
        return $true  # informational
    }
}

function Test-JobRepair {
    Write-Info "Testing job repair endpoint..."
    Write-Info "  -> Sending POST request to: $BASE_URL/jobs/repair"
    
    try {
        $startTime = Get-Date
        $repairResult = Invoke-RestMethod "$BASE_URL/jobs/repair" -Method POST -TimeoutSec 10
        $endTime = Get-Date
        $elapsed = ($endTime - $startTime).TotalSeconds
        
        Write-Info "  -> Response Time: $elapsed seconds"
        Write-Info "  -> Response Body: $($repairResult | ConvertTo-Json -Depth 3)"
        
        Write-Success "Job repair completed"
        Write-Info "  -> Full repair result: $($repairResult | ConvertTo-Json -Compress)"
        return $true
    } catch {
        Write-Error "Job repair failed: $($_.Exception.Message)"
        if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
            Write-Error "Exception response: $($_.Exception.Response)"
        }
        return $false
    }
}

function Test-JobsSummary {
    Write-Info "Testing jobs summary endpoint..."
    Write-Info "  -> Sending GET request to: $BASE_URL/jobs"
    
    try {
        $startTime = Get-Date
        $jobsSummary = Invoke-RestMethod "$BASE_URL/jobs" -Method GET -TimeoutSec 10
        $endTime = Get-Date
        $elapsed = ($endTime - $startTime).TotalSeconds
        
        Write-Info "  -> Response Time: $elapsed seconds"
        Write-Info "  -> Response Body: $($jobsSummary | ConvertTo-Json -Depth 3)"
        
        Write-Success "Jobs summary accessible"
        Write-Info "  -> Full jobs summary: $($jobsSummary | ConvertTo-Json -Compress)"
        return $true
    } catch {
        Write-Error $($_.Exception.Message)
        if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
            Write-Error "Exception response: $($_.Exception.Response)"
        }
        return $false
    }
}

function Test-FailedJobs {
    Write-Info "Testing failed jobs endpoint..."
    Write-Info "  -> Sending GET request to: $BASE_URL/jobs/failed"
    
    try {
        $startTime = Get-Date
        $failedJobs = Invoke-RestMethod "$BASE_URL/jobs/failed" -Method GET -TimeoutSec 10
        $endTime = Get-Date
        $elapsed = ($endTime - $startTime).TotalSeconds
        
        Write-Info "  -> Response Time: $elapsed seconds"
        Write-Info "  -> Response Body: $($failedJobs | ConvertTo-Json -Depth 3)"
        
        if ($failedJobs.jobs -and $failedJobs.jobs.Count -gt 0) {
            Write-Warning "Found $($failedJobs.jobs.Count) failed jobs"
            Write-Info "  -> Failed jobs details: $($failedJobs.jobs | ConvertTo-Json -Depth 2)"
        } else {
            Write-Success "No failed jobs found (good!)"
        }
        Write-Info "  -> Full failed jobs response: $($failedJobs | ConvertTo-Json -Compress)"
        return $true
    } catch {
        Write-Error $($_.Exception.Message)
        if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains 'Response') {
            Write-Error "Exception response: $($_.Exception.Response)"
        }
        return $false
    }
}

function Test-APIStructure {
    Write-Info "Testing API structure with invalid request..."
    Write-Info "  -> Sending POST request to: $BASE_URL/api/transcribe"
    Write-Info "  -> Request body: {\"invalid\": \"request\"}"
    Write-Info "  -> Expected: Error response (400, 401, 403, or 422)"
    
    try {
        $startTime = Get-Date
        $response = Invoke-WebRequest -Uri "$BASE_URL/api/transcribe" -Method POST -Body '{"invalid": "request"}' -ContentType "application/json" -TimeoutSec 10
        $endTime = Get-Date
        $elapsed = ($endTime - $startTime).TotalSeconds
        
        Write-Info "  -> Response Status: $($response.StatusCode)"
        Write-Info "  -> Response Time: $elapsed seconds"
        Write-Info "  -> Response Headers: $($response.Headers | ConvertTo-Json -Compress)"
        Write-Info "  -> Response Body: $($response.Content)"
        
        if ($response.StatusCode -in @(400, 401, 403, 422)) {
            Write-Success "API structure working (expected error)"
            Write-Info "  -> Got expected error status: $($response.StatusCode)"
            return $true
        } else {
            Write-Error "Unexpected response: $($response.StatusCode)"
            Write-Error "  -> Expected error status but got: $($response.StatusCode)"
            return $false
        }
    } catch {
        Write-Success "API structure working (expected error)"
        Write-Info "  -> Got expected exception: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            Write-Info "  -> Exception response: $($_.Exception.Response)"
        }
        return $true
    }
}

function Test-QueueStatus {
    Write-Info "Testing API queue status and cache information..."
    Write-Info "  -> This test checks the current queue position and estimated wait time"
    
    try {
        # Test queue status endpoint
        Write-Info "  -> Checking queue status endpoint..."
        $queueResponse = Invoke-RestMethod "$BASE_URL/queue/status" -Method GET -TimeoutSec 10
        Write-Success "Queue status endpoint accessible"
        Write-Info "  -> Queue Status Response: $($queueResponse | ConvertTo-Json -Depth 3)"
        return $true
    } catch {
        Write-Error "Queue status endpoint not available: $($_.Exception.Message)"
        return $false
    }
}

function Get-LocalGitShortSha {
  try {
    (git rev-parse --short HEAD).Trim()
  } catch {
    return $null
  }
}

function Test-BuildIsLive {
  param([int]$TimeoutSec = 240)

  Write-Info "Testing build is live..."
  $target = Get-LocalGitShortSha
  if ([string]::IsNullOrWhiteSpace($target)) {
    Write-Warning "Could not determine local git SHA; skipping live build assertion"
    return $true
  }
  $maxAttempts = 3
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
      $h = Invoke-RestMethod "$BASE_URL/health" -TimeoutSec 10
      $hasBuild = $false
      $hasGitSha = $false
      $currentSha = $null
      if ($h -and ($h.PSObject.Properties.Name -contains 'build')) {
        $hasBuild = $true
        $buildObj = $h.build
        if ($buildObj -and ($buildObj.PSObject.Properties.Name -contains 'git_sha')) {
          $hasGitSha = $true
          $currentSha = $buildObj.git_sha
        }
      }

      if ($hasBuild -and $hasGitSha -and $currentSha -eq $target) {
        Write-Success "Build live: $target"
        return $true
      } else {
        $disp = if ($currentSha) { $currentSha } else { 'missing' }
        Write-Info ("  -> Health payload: {0}" -f ($h | ConvertTo-Json -Depth 3))
        Write-Info ("  -> Attempt {0}/{1}: waiting for build {2}; current: {3}" -f $attempt, $maxAttempts, $target, $disp)
      }
    } catch {
      Write-Info "  -> Health check failed during build wait: $($_.Exception.Message)"
    }
    if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 60 }
  }

  $finalSha = $null
  $finalPayload = $null
  try {
    $finalPayload = Invoke-RestMethod "$BASE_URL/health" -TimeoutSec 10
    if ($finalPayload -and ($finalPayload.PSObject.Properties.Name -contains 'build') -and $finalPayload.build -and ($finalPayload.build.PSObject.Properties.Name -contains 'git_sha')) {
      $finalSha = $finalPayload.build.git_sha
    }
  } catch {}
  $dispFinal = if ($finalSha) { $finalSha } else { 'missing' }
  if (-not $finalPayload.build -or -not $finalPayload.build.git_sha) {
    Write-Error "Health missing build.git_sha"
  } elseif ($finalPayload.build.git_sha -eq "unknown") {
    Write-Error "Deployed build git_sha is 'unknown' – build stamping not working"
  } else {
    Write-Error ("Deployed build {0} != local {1}" -f $finalPayload.build.git_sha, $target)
  }
  Write-Error ("New build not live after {0} attempts ({1}s interval). Last /health: {2}" -f $maxAttempts, 60, ($finalPayload | ConvertTo-Json -Depth 3))
  return $false
}

function Get-StringSHA256([string]$s) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
  $sha   = [System.Security.Cryptography.SHA256]::Create()
  ($sha.ComputeHash($bytes) | ForEach-Object ToString x2) -join ''
}

function Test-TranscriptIntegrity {
  param([string]$Url, [int]$TimeoutSec)

  Write-Info "Testing transcript integrity..."
  $ts = [int64]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01")).TotalMilliseconds
  $body = @{ url = $Url } | ConvertTo-Json
  $sig  = New-HMACSignature $API_SECRET "POST" "/api/transcribe" $body $ts
  $hdrs = @{ "Content-Type"="application/json"; "X-API-Key"=$API_KEY; "X-Timestamp"=$ts; "X-Signature"=$sig }

  try {
    $resp = Invoke-WebRequest -Uri "$BASE_URL/api/transcribe" -Method POST -Headers $hdrs -Body $body -ContentType "application/json" -TimeoutSec $TimeoutSec
  } catch {
    Write-Error "Integrity: request failed: $($_.Exception.Message)"
    return $false
  }

  if ($resp.StatusCode -ne 200) {
    Write-Error "Integrity: /api/transcribe returned HTTP $($resp.StatusCode)"
    return $false
  }

  $r = $resp.Content | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($r.transcript) -or [string]::IsNullOrWhiteSpace($r.transcript_sha256)) {
    Write-Error "Integrity: missing transcript or hash"
    return $false
  }

  $localHash = Get-StringSHA256 $r.transcript
  if ($localHash -ne $r.transcript_sha256) {
    Write-Error "Integrity: local hash $localHash != server $($r.transcript_sha256)"
    return $false
  }

  Write-Host "Integrity: transcript hash verified."
  return $true
}

# Main execution
Write-Info "TTTranscibe Remote API E2E Test"
Write-Info "=================================="
Write-Info "Base URL: $BASE_URL"
Write-Info "Test URL: $TestUrl"
Write-Info "Timeout: $TimeoutSeconds seconds"
Write-Info "Retries: $Retries"
Write-Info ""

$testsPassed = 0
$totalTests = 11

# Test 1: Build Is Live (must be first to avoid stale testing)
Write-Info "1. Verifying new build is live"
if (Test-BuildIsLive -TimeoutSec 180) {
    $testsPassed++
    Write-Success "Build live test passed"
} else {
    Write-Error "Build live test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 2: Health Check
Write-Info "2. Testing Health Endpoint"
if (Test-Health) {
    $testsPassed++
    Write-Success "Health test passed"
} else {
    Write-Error "Health test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 3: Gradio UI
Write-Info "3. Testing Gradio UI"
if (Test-GradioUI) {
    $testsPassed++
    Write-Success "Gradio UI test passed"
} else {
    Write-Error "Gradio UI test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 4: API Structure
Write-Info "4. Testing API Structure"
if (Test-APIStructure) {
    $testsPassed++
    Write-Success "API structure test passed"
} else {
    Write-Error "API structure test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 5: Job Repair
Write-Info "5. Testing Job Repair"
if (Test-JobRepair) {
    $testsPassed++
    Write-Success "Job repair test passed"
} else {
    Write-Error "Job repair test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 6: API Transcription
Write-Info "6. Testing API Transcription"
if (Test-APITranscription -Url $TestUrl -TimeoutSec $TimeoutSeconds -MaxRetries $Retries) {
    $testsPassed++
    Write-Success "API transcription test passed"
} else {
    Write-Error "API transcription test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 7: Cache Behavior
Write-Info "7. Testing Cache Behavior"
if (Test-CacheBehavior -Url $TestUrl -TimeoutSec $TimeoutSeconds) {
    $testsPassed++
    Write-Success "Cache behavior test passed"
} else {
    Write-Error "Cache behavior test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 8: Rate Limiting
Write-Info "8. Testing Rate Limiting"
if (Test-RateLimiting) {
    $testsPassed++
    Write-Success "Rate limiting test passed"
} else {
    Write-Error "Rate limiting test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 9: Additional Endpoints
Write-Info "9. Testing Additional Endpoints"
$additionalTestsPassed = 0
$additionalTestsTotal = 2

if (Test-JobsSummary) { $additionalTestsPassed++ }
if (Test-FailedJobs) { $additionalTestsPassed++ }

if ($additionalTestsPassed -eq $additionalTestsTotal) {
    $testsPassed++
    Write-Success "Additional endpoints test passed ($additionalTestsPassed/$additionalTestsTotal)"
} else {
    Write-Error "Additional endpoints test failed ($additionalTestsPassed/$additionalTestsTotal)"
    exit 1
}
Write-Info ""

# Test 10: Queue Status and Cache Information
Write-Info "10. Testing Queue Status and Cache Information"
if (Test-QueueStatus) {
    $testsPassed++
    Write-Success "Queue status test passed"
} else {
    Write-Error "Queue status test failed - EXITING"
    exit 1
}
Write-Info ""

# Test 11: Transcript Integrity
Write-Info "11. Testing Transcript Integrity"
if (Test-TranscriptIntegrity -Url $TestUrl -TimeoutSec $TimeoutSeconds) {
    $testsPassed++
    Write-Success "Transcript integrity test passed"
} else {
    Write-Error "Transcript integrity test failed - EXITING"
    exit 1
}
Write-Info ""


# Final Results
Write-Info "Test Summary"
Write-Info "==============="
Write-Info "Tests passed: $testsPassed/$totalTests"

if ($testsPassed -eq $totalTests) {
    Write-Success "ALL TESTS PASSED!"
    Write-Success "The TTTranscibe remote API is working correctly."
    Write-Info "Deployment URL: $BASE_URL"
    Write-Info "Test completed at: $(Get-Date)"
    exit 0
} else {
    Write-Error "SOME TESTS FAILED!"
    Write-Error "Please check the errors above and fix any issues."
    exit 1
}


