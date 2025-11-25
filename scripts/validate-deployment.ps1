# TTTranscribe Deployment Validation Script
# Waits 160 seconds for server restart, then validates the service

param(
    [string]$BaseUrl = "https://iamromeoly-tttranscribe.hf.space",
    [string]$AuthSecret = "hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU",
    [string]$TestUrl = "https://vm.tiktok.com/ZMADQVF4e/",
    [int]$WaitSeconds = 160
)

$ErrorActionPreference = 'Stop'

function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Success { param($Message) Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Warning { param($Message) Write-Host "[WARNING] $Message" -ForegroundColor Yellow }

Write-Info "TTTranscribe Deployment Validation Script"
Write-Info "Base URL: $BaseUrl"
Write-Info "Test URL: $TestUrl"
Write-Info "Waiting $WaitSeconds seconds for server to restart..."

# Wait for server restart
$startTime = Get-Date
$endTime = $startTime.AddSeconds($WaitSeconds)

while ((Get-Date) -lt $endTime) {
    $remaining = [math]::Round(($endTime - (Get-Date)).TotalSeconds)
    Write-Host "`rWaiting... $remaining seconds remaining" -NoNewline
    Start-Sleep -Seconds 5
}
Write-Host "`n" # New line after countdown

Write-Info "Starting validation tests..."

# Test 1: Health Check
Write-Info "Test 1: Health Check"
try {
    $healthResponse = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -TimeoutSec 10 -ErrorAction Stop
    if ($healthResponse.StatusCode -eq 200) {
        $healthData = $healthResponse.Content | ConvertFrom-Json
        if ($healthData.status -eq "healthy" -or $healthData.status -eq "ok") {
            Write-Success "Health check passed"
            Write-Info "Platform: $($healthData.platform)"
            Write-Info "Service: $($healthData.service)"
        } else {
            Write-Error "Health check failed: status is $($healthData.status)"
            exit 1
        }
    } else {
        Write-Error "Health check failed: HTTP $($healthResponse.StatusCode)"
        exit 1
    }
} catch {
    Write-Error "Health check failed: $($_.Exception.Message)"
    exit 1
}

# Test 2: Submit Transcription Job
Write-Info "Test 2: Submit Transcription Job"
try {
    $headers = @{
        "X-Engine-Auth" = $AuthSecret
        "Content-Type" = "application/json"
    }
    
    $body = @{
        url = $TestUrl
    } | ConvertTo-Json
    
    $transcribeResponse = Invoke-WebRequest -Uri "$BaseUrl/transcribe" -Method POST -Headers $headers -Body $body -TimeoutSec 30 -ErrorAction Stop
    
    if ($transcribeResponse.StatusCode -eq 200 -or $transcribeResponse.StatusCode -eq 202) {
        $transcribeData = $transcribeResponse.Content | ConvertFrom-Json
        $requestId = if ($transcribeData.id) { $transcribeData.id } else { $transcribeData.request_id }
        
        if ($requestId) {
            Write-Success "Transcription job submitted: $requestId"
        } else {
            Write-Error "Transcription job submission failed: no request ID in response"
            exit 1
        }
    } else {
        Write-Error "Transcription job submission failed: HTTP $($transcribeResponse.StatusCode)"
        exit 1
    }
} catch {
    Write-Error "Transcription job submission failed: $($_.Exception.Message)"
    exit 1
}

# Test 3: Poll for Completion (up to 5 minutes)
Write-Info "Test 3: Polling for Transcription Completion"
$maxAttempts = 60
$attempt = 0
$completed = $false
$hasValidTranscript = $false

while ($attempt -lt $maxAttempts -and -not $completed) {
    $attempt++
    Start-Sleep -Seconds 5
    
    try {
        $statusHeaders = @{
            "X-Engine-Auth" = $AuthSecret
        }
        
        $statusResponse = Invoke-WebRequest -Uri "$BaseUrl/status/$requestId" -Method GET -Headers $statusHeaders -TimeoutSec 10 -ErrorAction Stop
        
        if ($statusResponse.StatusCode -eq 200) {
            $statusData = $statusResponse.Content | ConvertFrom-Json
            $status = $statusData.status
            $progress = if ($statusData.progress) { $statusData.progress } else { $statusData.percent }
            
            Write-Host "`rStatus: $status ($progress%) - Attempt $attempt/$maxAttempts" -NoNewline
            
            if ($status -eq "completed") {
                $completed = $true
                Write-Host "`n" # New line
                
                # Check if we have a valid transcript
                if ($statusData.result -and $statusData.result.transcription) {
                    $transcript = $statusData.result.transcription
                    
                    # Check if it's a real transcript (not an error message)
                    if (-not $transcript.StartsWith("[Transcription failed") -and 
                        -not $transcript.StartsWith("[PLACEHOLDER") -and
                        -not $transcript.StartsWith("[Transcription placeholder")) {
                        Write-Success "Valid transcript received!"
                        Write-Info "Transcript length: $($transcript.Length) characters"
                        Write-Info "Word count: $($statusData.result.wordCount)"
                        $hasValidTranscript = $true
                    } else {
                        Write-Warning "Transcript received but appears to be an error/placeholder: $($transcript.Substring(0, [Math]::Min(100, $transcript.Length)))"
                    }
                } else {
                    Write-Warning "Status is completed but no transcript in result"
                }
            } elseif ($status -eq "failed") {
                Write-Host "`n" # New line
                Write-Error "Transcription job failed: $($statusData.note)"
                exit 1
            }
        }
    } catch {
        Write-Host "`n" # New line
        Write-Warning "Error checking status: $($_.Exception.Message)"
    }
}

if (-not $completed) {
    Write-Host "`n" # New line
    Write-Error "Transcription did not complete within timeout period"
    exit 1
}

# Test 4: Verify Cached Response
Write-Info "Test 4: Verify Cached Response (same URL should return cached result)"
try {
    $cachedResponse = Invoke-WebRequest -Uri "$BaseUrl/transcribe" -Method POST -Headers $headers -Body $body -TimeoutSec 30 -ErrorAction Stop
    
    if ($cachedResponse.StatusCode -eq 200 -or $cachedResponse.StatusCode -eq 202) {
        $cachedData = $cachedResponse.Content | ConvertFrom-Json
        $cachedRequestId = if ($cachedData.id) { $cachedData.id } else { $cachedData.request_id }
        
        # Wait a moment for cached result
        Start-Sleep -Seconds 2
        
        $cachedStatusResponse = Invoke-WebRequest -Uri "$BaseUrl/status/$cachedRequestId" -Method GET -Headers $statusHeaders -TimeoutSec 10 -ErrorAction Stop
        $cachedStatusData = $cachedStatusResponse.Content | ConvertFrom-Json
        
        if ($cachedStatusData.status -eq "completed") {
            Write-Success "Cached response working correctly"
        } else {
            Write-Warning "Cached response status: $($cachedStatusData.status)"
        }
    }
} catch {
    Write-Warning "Cache test failed: $($_.Exception.Message)"
}

# Final Summary
Write-Info "`n=== Validation Summary ==="
if ($hasValidTranscript) {
    Write-Success "✅ All validation tests passed!"
    Write-Success "✅ Service is generating and serving transcripts correctly"
    exit 0
} else {
    Write-Error "❌ Validation failed: Service is not generating valid transcripts"
    Write-Error "The service may be returning error messages instead of actual transcriptions"
    exit 1
}

