param(
    [string]$Environment = "auto",
    [string]$TestUrl = "https://vm.tiktok.com/ZMAPTWV7o/",
    [string]$ApiKey = "CLIENT_A_KEY_123",
    [string]$ApiSecret = "CLIENT_A_SECRET_ABC"
)

$ErrorActionPreference = 'Stop'
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    } else {
        $input | Write-Output
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Success { Write-ColorOutput Green $args }
function Write-Error { Write-ColorOutput Red $args }
function Write-Warning { Write-ColorOutput Yellow $args }
function Write-Info { Write-ColorOutput Cyan $args }

# Environment detection
if ($Environment -eq "auto") {
    Write-Info "🔍 Auto-detecting environment..."
    try {
        $localResponse = Invoke-WebRequest -Uri "http://localhost:7860/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
        if ($localResponse.StatusCode -eq 200) {
            $Environment = "local"
            $BaseUrl = "http://localhost:7860"
            Write-Info "✅ Detected local environment"
        }
    } catch {
        try {
            $remoteResponse = Invoke-WebRequest -Uri "https://iamromeoly-tttranscibe.hf.space/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
            if ($remoteResponse.StatusCode -eq 200) {
                $Environment = "remote"
                $BaseUrl = "https://iamromeoly-tttranscibe.hf.space"
                Write-Info "✅ Detected remote environment"
            }
        } catch {
            Write-Error "❌ Could not detect environment, defaulting to remote"
            $Environment = "remote"
            $BaseUrl = "https://iamromeoly-tttranscibe.hf.space"
        }
    }
} else {
    $BaseUrl = if ($Environment -eq "local") { "http://localhost:7860" } else { "https://iamromeoly-tttranscibe.hf.space" }
}

Write-Info "🧪 TTTranscibe API Test"
Write-Info "Environment: $Environment"
Write-Info "Base URL: $BaseUrl"
Write-Info "Test URL: $TestUrl"
Write-Info ""

# Test 1: Health endpoint
Write-Info "1️⃣ Testing Health Endpoint"
try {
    $healthResponse = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -TimeoutSec 10
    Write-Info "   Status: $($healthResponse.StatusCode)"
    if ($healthResponse.StatusCode -eq 200) {
        $healthData = $healthResponse.Content | ConvertFrom-Json
        Write-Info "   Response: $($healthData | ConvertTo-Json -Depth 3)"
        Write-Success "   ✅ Health test passed"
    } else {
        Write-Error "   ❌ Health test failed"
    }
} catch {
    Write-Error "   ❌ Health test failed: $($_.Exception.Message)"
}
Write-Info ""

# Test 2: API Authentication and Transcription
Write-Info "2️⃣ Testing API Authentication and Transcription"

# Generate timestamp and signature
$timestamp = [int64]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalMilliseconds
$body = @{url = $TestUrl} | ConvertTo-Json
$bodyJson = $body

# Create signature using .NET HMAC
$hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($ApiSecret))
$stringToSign = "POST`n/api/transcribe`n$bodyJson`n$timestamp"
$signature = [System.BitConverter]::ToString($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($stringToSign))).Replace("-", "").ToLower()
$hmac.Dispose()

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Key" = $ApiKey
    "X-Timestamp" = $timestamp.ToString()
    "X-Signature" = $signature
}

Write-Info "   Timestamp: $timestamp"
Write-Info "   Signature: $signature"
Write-Info "   Body: $bodyJson"

try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST -Headers $headers -Body $bodyJson -ContentType "application/json" -TimeoutSec 60
    Write-Info "   Status: $($response.StatusCode)"
    
    if ($response.StatusCode -eq 200) {
        $result = $response.Content | ConvertFrom-Json
        Write-Success "   ✅ SUCCESS!"
        Write-Info "   Request ID: $($result.request_id)"
        Write-Info "   Status: $($result.status)"
        Write-Info "   Language: $($result.lang)"
        Write-Info "   Duration: $($result.duration_sec) seconds"
        Write-Info "   Transcript: $($result.transcript.Substring(0, [Math]::Min(200, $result.transcript.Length)))..."
        Write-Info "   Source: $($result.source | ConvertTo-Json -Compress)"
        Write-Info "   Elapsed: $($result.elapsed_ms) ms"
    } else {
        Write-Error "   ❌ Error: $($response.Content)"
    }
} catch {
    Write-Error "   ❌ Request failed: $($_.Exception.Message)"
}
Write-Info ""

# Test 3: Gradio UI
Write-Info "3️⃣ Testing Gradio UI"
try {
    $uiResponse = Invoke-WebRequest -Uri "$BaseUrl/" -Method GET -TimeoutSec 10
    Write-Info "   Status: $($uiResponse.StatusCode)"
    if ($uiResponse.StatusCode -eq 200 -and $uiResponse.Content -like "*gradio*") {
        Write-Success "   ✅ Gradio UI is accessible"
    } else {
        Write-Error "   ❌ Gradio UI not accessible or not found"
    }
} catch {
    Write-Error "   ❌ Error: $($_.Exception.Message)"
}
Write-Info ""

Write-Info "🎉 API Test Complete!"
Write-Info "Check the results above to see if the API is working correctly."
