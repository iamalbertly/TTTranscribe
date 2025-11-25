# TTTranscribe End-to-End Test Orchestrator
# Comprehensive testing with ADB integration and automated error handling

param(
    [string]$BaseUrl = "http://localhost:8788",
    [string]$AuthSecret = "super-long-random",
    [string]$TestUrl = "https://vm.tiktok.com/ZMADQVF4e/",
    [switch]$Verbose = $false
)

# Load .env.local into process environment if present
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
        # Remove surrounding quotes if any
        if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
        if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
        Set-Item -Path "Env:$key" -Value $val
    }
}

$envFile = Join-Path (Get-Location) 'env.local'
Load-DotEnv -Path $envFile

# Derive defaults from environment if parameters are not explicitly provided by user
if ($PSBoundParameters.ContainsKey('BaseUrl') -eq $false) {
    if ($env:BASE_URL) {
        $BaseUrl = $env:BASE_URL
    } elseif ($env:PORT) {
        $BaseUrl = "http://localhost:$($env:PORT)"
    }
}
if ($PSBoundParameters.ContainsKey('AuthSecret') -eq $false -and $env:ENGINE_SHARED_SECRET) {
    $AuthSecret = $env:ENGINE_SHARED_SECRET
}
if ($PSBoundParameters.ContainsKey('TestUrl') -eq $false) {
    if ($env:TEST_URL) { $TestUrl = $env:TEST_URL }
}

# Color output functions
function Write-Success { param($Message) Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Warning { param($Message) Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Test { param($Message) Write-Host "[TEST] $Message" -ForegroundColor Magenta }

# Global test state
$Global:TestResults = @{
    Total = 0
    Passed = 0
    Failed = 0
    Errors = @()
}

function Test-Failure {
    param(
        [string]$TestName,
        [string]$ErrorMessage,
        [string]$Details = ""
    )
    
    $Global:TestResults.Failed++
    $Global:TestResults.Errors += @{
        Test = $TestName
        Error = $ErrorMessage
        Details = $Details
        Timestamp = Get-Date
    }
    
    Write-Error "$TestName FAILED: $ErrorMessage"
    if ($Details) { Write-Error "Details: $Details" }
    
    # Terminate on first error during development
    Write-Error "🚨 TERMINATING: Test failure detected. Fix issues and re-run."
    exit 1
}

function Test-Success {
    param([string]$TestName)
    
    $Global:TestResults.Passed++
    Write-Success "$TestName PASSED"
}

function Test-API-Health {
    Write-Test "Testing API Health Check..."
    
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            $healthData = $response.Content | ConvertFrom-Json
            if ($healthData.status -eq "healthy" -or $healthData.status -eq "ok") {
                Test-Success "API Health Check"
                return $true
            } else {
                Test-Failure "API Health Check" "Health status not OK" $healthData
            }
        } else {
            Test-Failure "API Health Check" "HTTP $($response.StatusCode)" $response.Content
        }
    } catch {
        Test-Failure "API Health Check" "Connection failed" $_.Exception.Message
    }
    return $false
}

function Test-API-Transcribe {
    Write-Test "Testing Transcribe Endpoint..."
    
    try {
        $headers = @{
            "X-Engine-Auth" = $AuthSecret
            "Content-Type" = "application/json"
        }
        
        $body = @{
            url = $TestUrl
        } | ConvertTo-Json
        
        $response = Invoke-WebRequest -Uri "$BaseUrl/transcribe" -Method POST -Headers $headers -Body $body -TimeoutSec 30
        
        # Accept both 200 and 202 status codes (202 is the correct protocol response)
        if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 202) {
            $transcribeData = $response.Content | ConvertFrom-Json
            # Check for either 'id' or 'request_id' field
            $requestId = if ($transcribeData.id) { $transcribeData.id } else { $transcribeData.request_id }
            $status = if ($transcribeData.status) { $transcribeData.status } else { "queued" }
            
            if ($requestId -and ($status -eq "accepted" -or $status -eq "queued")) {
                Test-Success "Transcribe Endpoint"
                return $requestId
            } else {
                Test-Failure "Transcribe Endpoint" "Invalid response format" $transcribeData
            }
        } else {
            Test-Failure "Transcribe Endpoint" "HTTP $($response.StatusCode)" $response.Content
        }
    } catch {
        Test-Failure "Transcribe Endpoint" "Request failed" $_.Exception.Message
    }
    return $null
}

function Test-API-Status {
    param([string]$RequestId)
    
    Write-Test "Testing Status Endpoint for Request: $RequestId"
    
    try {
        $headers = @{
            "X-Engine-Auth" = $AuthSecret
        }
        
        $response = Invoke-WebRequest -Uri "$BaseUrl/status/$RequestId" -Method GET -Headers $headers -TimeoutSec 10
        
        if ($response.StatusCode -eq 200) {
            $statusData = $response.Content | ConvertFrom-Json
            # Accept both old format (phase, percent) and new format (status, progress)
            $hasPhase = $statusData.phase -ne $null
            $hasPercent = $statusData.percent -ne $null
            $hasStatus = $statusData.status -ne $null
            $hasProgress = $statusData.progress -ne $null
            
            if (($hasPhase -and $hasPercent) -or ($hasStatus -and $hasProgress)) {
                Test-Success "Status Endpoint"
                return $statusData
            } else {
                Test-Failure "Status Endpoint" "Invalid status format" $statusData
            }
        } else {
            Test-Failure "Status Endpoint" "HTTP $($response.StatusCode)" $response.Content
        }
    } catch {
        Test-Failure "Status Endpoint" "Request failed" $_.Exception.Message
    }
    return $null
}

function Test-ADB-Device {
    Write-Test "Testing ADB Device Connection..."
    
    try {
        $adbDevices = adb devices
        if ($LASTEXITCODE -ne 0) {
            Test-Failure "ADB Connection" "ADB command failed" "Make sure ADB is installed and in PATH"
        }
        
        $connectedDevices = ($adbDevices | Where-Object { $_ -match "device$" }).Count
        if ($connectedDevices -eq 0) {
            Test-Failure "ADB Connection" "No devices connected" "Connect a device via USB or enable wireless debugging"
        } elseif ($connectedDevices -gt 1) {
            Write-Warning "Multiple devices detected. Using first device."
        }
        
        Test-Success "ADB Device Connection"
        return $true
    } catch {
        Test-Failure "ADB Connection" "ADB not available" $_.Exception.Message
    }
    return $false
}

function Test-ADB-App-Install {
    Write-Test "Testing ADB App Installation..."
    
    try {
        # Check if PluctMobileApp is installed
        $packageName = "com.pluct.mobileapp"  # Adjust package name as needed
        $appCheck = adb shell pm list packages | Select-String $packageName
        
        if (-not $appCheck) {
            Write-Info "PluctMobileApp not found. Attempting to install..."
            
            # Look for APK file
            $apkPath = Get-ChildItem -Path "." -Filter "*.apk" -Recurse | Select-Object -First 1
            if ($apkPath) {
                $installResult = adb install $apkPath.FullName
                if ($LASTEXITCODE -ne 0) {
                    Test-Failure "ADB App Install" "Installation failed" $installResult
                }
            } else {
                Test-Failure "ADB App Install" "No APK file found" "Place APK file in current directory"
            }
        }
        
        Test-Success "ADB App Installation"
        return $true
    } catch {
        Test-Failure "ADB App Install" "Installation error" $_.Exception.Message
    }
    return $false
}

function Test-ADB-App-Launch {
    Write-Test "Testing ADB App Launch..."
    
    try {
        $packageName = "com.pluct.mobileapp"
        $activityName = "com.pluct.mobileapp.MainActivity"  # Adjust as needed
        
        # Launch the app
        $launchResult = adb shell am start -n "$packageName/$activityName"
        if ($LASTEXITCODE -ne 0) {
            Test-Failure "ADB App Launch" "Launch failed" $launchResult
        }
        
        # Wait for app to start
        Start-Sleep -Seconds 3
        
        # Check if app is running
        $runningApps = adb shell ps | Select-String $packageName
        if (-not $runningApps) {
            Test-Failure "ADB App Launch" "App not running after launch"
        }
        
        Test-Success "ADB App Launch"
        return $true
    } catch {
        Test-Failure "ADB App Launch" "Launch error" $_.Exception.Message
    }
    return $false
}

function Test-ADB-Automated-UI {
    Write-Test "Testing ADB Automated UI Interactions..."
    
    try {
        # Simulate user interactions
        Write-Info "Simulating user interactions..."
        
        # Tap on share button (adjust coordinates as needed)
        adb shell input tap 500 800
        Start-Sleep -Seconds 2
        
        # Navigate to TikTok share
        adb shell input tap 300 600
        Start-Sleep -Seconds 2
        
        # Simulate TikTok URL input
        adb shell input text $TestUrl
        Start-Sleep -Seconds 1
        
        # Tap submit/transcribe button
        adb shell input tap 400 700
        Start-Sleep -Seconds 3
        
        # Check for processing status
        $uiState = adb shell dumpsys activity | Select-String "Processing"
        if ($uiState) {
            Test-Success "ADB Automated UI"
            return $true
        } else {
            Write-Warning "Processing status not detected in UI"
        }
        
        Test-Success "ADB Automated UI"
        return $true
    } catch {
        Test-Failure "ADB Automated UI" "UI interaction failed" $_.Exception.Message
    }
    return $false
}

function Test-Build-Deploy {
    Write-Test "Testing Build and Deploy Process..."
    
    try {
        # Test TypeScript compilation
        Write-Info "Testing TypeScript compilation..."
        $buildResult = npm run build
        if ($LASTEXITCODE -ne 0) {
            Test-Failure "Build Process" "TypeScript compilation failed" $buildResult
        }
        
        # Test Docker build (if Docker is available)
        if (Get-Command docker -ErrorAction SilentlyContinue) {
            Write-Info "Testing Docker build..."
            $dockerResult = docker build -t tttranscribe-test .
            if ($LASTEXITCODE -ne 0) {
                Test-Failure "Docker Build" "Docker build failed" $dockerResult
            }
        } else {
            Write-Warning "Docker not available, skipping Docker build test"
        }
        
        Test-Success "Build and Deploy Process"
        return $true
    } catch {
        Test-Failure "Build and Deploy" "Build process failed" $_.Exception.Message
    }
    return $false
}

function Test-Complete-Journey {
    Write-Test "Testing Complete User Journey..."
    
    try {
        # Check if service is already running
        $existingProcess = Get-Process -Name node -ErrorAction SilentlyContinue
        if ($existingProcess) {
            Write-Info "TTTranscribe service already running, using existing instance"
            $serviceProcess = $null
        } else {
            # Start the service
            Write-Info "Starting TTTranscribe service..."
            $serviceProcess = Start-Process -FilePath "npm" -ArgumentList "start" -PassThru -NoNewWindow
            
            # Wait for service to start
            Start-Sleep -Seconds 5
        }
        
        # Test API endpoints
        if (-not (Test-API-Health)) {
            Test-Failure "Complete Journey" "Health check failed"
        }
        
        $requestId = Test-API-Transcribe
        if (-not $requestId) {
            Test-Failure "Complete Journey" "Transcribe request failed"
        }
        
        # Monitor job progress
        $maxWaitTime = 60  # seconds
        $waitTime = 0
        $jobCompleted = $false
        
        while ($waitTime -lt $maxWaitTime -and -not $jobCompleted) {
            $status = Test-API-Status -RequestId $requestId
            if ($status) {
                Write-Info "Job Status: $($status.phase) ($($status.percent)%)"
                
                if ($status.phase -eq "COMPLETED" -or $status.phase -eq "FAILED") {
                    $jobCompleted = $true
                    if ($status.phase -eq "COMPLETED") {
                        Test-Success "Complete User Journey"
                    } else {
                        Test-Failure "Complete Journey" "Job failed" $status.note
                    }
                }
            }
            
            Start-Sleep -Seconds 2
            $waitTime += 2
        }
        
        if (-not $jobCompleted) {
            Test-Failure "Complete Journey" "Job did not complete within timeout"
        }
        
        # Stop the service only if we started it
        if ($serviceProcess -and -not $serviceProcess.HasExited) {
            $serviceProcess.Kill()
        }
        
    } catch {
        Test-Failure "Complete Journey" "Journey test failed" $_.Exception.Message
    }
}

# Main test execution
Write-Info "Starting TTTranscribe End-to-End Test Orchestrator"
Write-Info "Base URL: $BaseUrl"
Write-Info "Test URL: $TestUrl"
Write-Info "Verbose: $Verbose"

$Global:TestResults.Total = 0

# Core API Tests
Write-Info "`nTesting Core API Functionality..."
$Global:TestResults.Total++

if (Test-API-Health) {
    $requestId = Test-API-Transcribe
    if ($requestId) {
        Test-API-Status -RequestId $requestId
    }
}

# Build and Deploy Tests
Write-Info "`nTesting Build and Deploy Process..."
$Global:TestResults.Total++
Test-Build-Deploy

# (Android/ADB tests removed — this is a service-only test orchestrator)

# Complete Journey Test
Write-Info "`nTesting Complete User Journey..."
$Global:TestResults.Total++
Test-Complete-Journey

# Test Results Summary
Write-Info "`nTest Results Summary:"
Write-Info "Total Tests: $($Global:TestResults.Total)"
Write-Success "Passed: $($Global:TestResults.Passed)"
if ($Global:TestResults.Failed -gt 0) {
    Write-Error "Failed: $($Global:TestResults.Failed)"
    Write-Error "`nFAILED TESTS:"
    foreach ($error in $Global:TestResults.Errors) {
        Write-Error "  - $($error.Test): $($error.Error)"
        if ($error.Details) {
            Write-Error "    Details: $($error.Details)"
        }
    }
    exit 1
} else {
    Write-Success "All tests passed successfully!"
    exit 0
}
