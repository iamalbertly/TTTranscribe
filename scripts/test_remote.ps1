 
param(
  [string]$Owner = "iamromeoly",
  [string]$SpaceName = "TTTranscibe",
  [string]$Token = "",
  [string]$VideoUrl = "https://vm.tiktok.com/ZMAPTWV7o/",
  [int]$TimeoutSec = 300,
  [switch]$SkipDeploy = $false
)

$ErrorActionPreference = "Stop"
function Print { param($m) Write-Host "[test] $m" -ForegroundColor Green }
function PrintError { param($m) Write-Host "[ERROR] $m" -ForegroundColor Red }
function PrintWarning { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }

# Validate required parameters
# Require token only when deployment is not skipped. Allow env fallback.
if ([string]::IsNullOrEmpty($Token) -and -not $SkipDeploy) {
    if (-not [string]::IsNullOrWhiteSpace($env:HUGGINGFACE_HUB_TOKEN)) {
        $Token = $env:HUGGINGFACE_HUB_TOKEN
    } else {
        PrintError "Hugging Face token is required unless -SkipDeploy is set. Provide -Token or set HUGGINGFACE_HUB_TOKEN."
        exit 1
    }
}

if ([string]::IsNullOrEmpty($VideoUrl)) {
    PrintError "Video URL is required. Use -VideoUrl parameter."
    exit 1
}

$BaseUrl = "https://$Owner-$SpaceName.hf.space"

Print "=== TikTok Transcriber End-to-End Test ==="
Print "Owner: $Owner"
Print "Space: $SpaceName"
Print "Base URL: $BaseUrl"
Print "Video URL: $VideoUrl"
Print "Timeout: $TimeoutSec seconds"

# Step 1: Deploy to Hugging Face (if not skipped)
if (-not $SkipDeploy) {
    Print "=== Step 1: Deploying to Hugging Face ==="
    
    # Check if git is available
    try {
        $gitVersion = git --version
        Print "Git available: $gitVersion"
    } catch {
        PrintError "Git is not available. Please install Git to deploy to Hugging Face."
        exit 1
    }
    
    # Check if huggingface_hub is available
    try {
        $hfVersion = python -c "import huggingface_hub; print(huggingface_hub.__version__)"
        Print "Hugging Face Hub available: $hfVersion"
    } catch {
        PrintError "Hugging Face Hub not available. Installing..."
        pip install huggingface_hub
    }
    
    # Login to Hugging Face
    Print "Logging in to Hugging Face..."
    try {
        $env:HUGGINGFACE_HUB_TOKEN = $Token
        python -c "from huggingface_hub import login; login('$Token')"
        Print "Successfully logged in to Hugging Face"
    } catch {
        PrintError "Failed to login to Hugging Face: $_"
        exit 1
    }
    
    # Check if there are changes to commit
    Print "Checking for changes to commit..."
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Print "Found changes to commit:"
        $gitStatus | ForEach-Object { Print "  $_" }
        
        # Add all changes
        Print "Adding all changes..."
        git add .
        
        # Commit changes
        $commitMessage = "Refactored codebase - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        Print "Committing changes: $commitMessage"
        git commit -m $commitMessage
        
        # Push to Hugging Face
        Print "Pushing to Hugging Face Space..."
        try {
            $uploadResult = python -c "
import os
import sys
from huggingface_hub import HfApi
try:
    api = HfApi()
    result = api.upload_folder(
        folder_path='.',
        repo_id='$Owner/$SpaceName',
        repo_type='space',
        commit_message='$commitMessage'
    )
    print('SUCCESS: Successfully pushed to Hugging Face Space')
    sys.exit(0)
except Exception as e:
    print(f'ERROR: {str(e)}')
    sys.exit(1)
" 2>&1
            
            if ($LASTEXITCODE -ne 0) {
                PrintError "Failed to push to Hugging Face: $uploadResult"
                exit 1
            }
            Print "Successfully deployed to Hugging Face Space"
        } catch {
            PrintError "Failed to push to Hugging Face: $_"
            exit 1
        }
    } else {
        Print "No changes to commit. Skipping deployment."
    }
} else {
    Print "Skipping deployment (--SkipDeploy flag set)"
}

# Step 2: Wait for deployment to be ready
Print "=== Step 2: Waiting for deployment to be ready ==="
$maxWaitTime = 300 # 5 minutes
$waitStart = Get-Date
$deploymentReady = $false

while (-not $deploymentReady -and ((Get-Date) - $waitStart).TotalSeconds -lt $maxWaitTime) {
    try {
        Print "Checking if deployment is ready..."
        $health = Invoke-RestMethod "$BaseUrl/health" -Method GET -TimeoutSec 10
        if ($health.status -eq "ok") {
            $deploymentReady = $true
            Print "Deployment is ready!"
        }
    } catch {
        Print "Deployment not ready yet, waiting 10 seconds..."
        Start-Sleep -Seconds 10
    }
}

if (-not $deploymentReady) {
    PrintError "Deployment did not become ready within $maxWaitTime seconds"
    exit 1
}

# Step 3: Test health endpoint
Print "=== Step 3: Testing Health Endpoint ==="
try {
    $health = Invoke-RestMethod "$BaseUrl/health" -Method GET
    Print "Health check passed:"
    $health | ConvertTo-Json -Depth 6 | Write-Host
    
    # Validate health response
    $requiredFields = @("status", "worker_active", "db_ok", "yt_dlp_ok", "ffmpeg_ok")
    foreach ($field in $requiredFields) {
        if (-not $health.PSObject.Properties.Name -contains $field) {
            PrintError "Health response missing required field: $field"
            exit 1
        }
    }
    
    if ($health.status -ne "ok") {
        PrintError "Health status is not 'ok': $($health.status)"
        exit 1
    }
} catch {
    PrintError "Health check failed: $_"
    exit 1
}

# Step 4: Test job repair endpoint
Print "=== Step 4: Testing Job Repair ==="
try {
    $repairResult = Invoke-RestMethod "$BaseUrl/jobs/repair" -Method POST
    Print "Job repair completed:"
    $repairResult | ConvertTo-Json -Depth 6 | Write-Host
} catch {
    PrintError "Job repair failed: $_"
    exit 1
}

# Step 5: Test transcription pipeline
Print "=== Step 5: Testing Transcription Pipeline ==="
Print "Submitting transcription job for: $VideoUrl"

try {
    $transcribeBody = @{url=$VideoUrl} | ConvertTo-Json
    $resp = Invoke-RestMethod "$BaseUrl/transcribe" -Method POST -Body $transcribeBody -ContentType "application/json"
    $jobId = if ($resp.id) { $resp.id } else { $resp.job_id }
    Print "Job submitted successfully. Job ID: $jobId"
} catch {
    PrintError "Failed to submit transcription job: $_"
    exit 1
}

# Step 6: Monitor job progress
Print "=== Step 6: Monitoring Job Progress ==="
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$jobCompleted = $false
$lastStatus = ""

while (-not $jobCompleted -and (Get-Date) -lt $deadline) {
    try {
        Start-Sleep -Seconds 5
        $status = Invoke-RestMethod "$BaseUrl/transcribe/$jobId" -Method GET
        
        if ($status.status -ne $lastStatus) {
            Print "Status changed: $($lastStatus) -> $($status.status)"
            $lastStatus = $status.status
        }
        
        switch ($status.status) {
            "COMPLETE" {
                Print "✅ TRANSCRIPTION COMPLETED SUCCESSFULLY!"
                $status | ConvertTo-Json -Depth 8 | Write-Host
                
                # Validate completion response
                if ($status.data -and $status.data.text) {
                    Print "Transcript text length: $($status.data.text.Length) characters"
                    Print "First 100 characters: $($status.data.text.Substring(0, [Math]::Min(100, $status.data.text.Length)))"
                } elseif ($status.result -and $status.result.text) {
                    Print "Transcript text length: $($status.result.text.Length) characters"
                    Print "First 100 characters: $($status.result.text.Substring(0, [Math]::Min(100, $status.result.text.Length)))"
                }
                
                if ($status.transcript_url) {
                    Print "Transcript URL: $($status.transcript_url)"
                } elseif ($status.result -and $status.result.transcript_url) {
                    Print "Transcript URL: $($status.result.transcript_url)"
                }
                
                $jobCompleted = $true
            }
            "FAILED" {
                PrintError "❌ TRANSCRIPTION FAILED!"
                PrintError "Error code: $($status.code)"
                PrintError "Error message: $($status.message)"
                if ($status.error_message) {
                    PrintError "Detailed error: $($status.error_message)"
                }
                exit 1
            }
            default {
                # Continue monitoring
                $timeRemaining = [Math]::Max(0, ($deadline - (Get-Date)).TotalSeconds)
                Print "Status: $($status.status) (Time remaining: $([Math]::Round($timeRemaining))s)"
            }
        }
    } catch {
        PrintError "Failed to check job status: $_"
        exit 1
    }
}

if (-not $jobCompleted) {
    PrintError "❌ JOB DID NOT COMPLETE WITHIN TIMEOUT ($TimeoutSec seconds)"
    PrintError "Final status: $lastStatus"
    exit 1
}

# Step 7: Test additional endpoints
Print "=== Step 7: Testing Additional Endpoints ==="

# Test jobs summary
try {
    Print "Testing jobs summary..."
    $jobsSummary = Invoke-RestMethod "$BaseUrl/jobs" -Method GET
    Print "Jobs summary:"
    $jobsSummary | ConvertTo-Json -Depth 6 | Write-Host
} catch {
    PrintWarning "Jobs summary test failed: $_"
}

# Test failed jobs (should be empty)
try {
    Print "Testing failed jobs endpoint..."
    $failedJobs = Invoke-RestMethod "$BaseUrl/jobs/failed" -Method GET
    if ($failedJobs.jobs -and $failedJobs.jobs.Count -gt 0) {
        PrintWarning "Found $($failedJobs.jobs.Count) failed jobs"
    } else {
        Print "No failed jobs found (good!)"
    }
} catch {
    PrintWarning "Failed jobs test failed: $_"
}

Print "=== 🎉 ALL TESTS PASSED SUCCESSFULLY! ==="
Print "The TikTok Transcriber is working correctly end-to-end."
Print "Deployment URL: $BaseUrl"
Print "Test completed at: $(Get-Date)"

# Step 1: Deploy to Hugging Face (if not skipped)
if (-not $SkipDeploy) {
    Print "=== Step 1: Deploying to Hugging Face ==="
    
    # Check if git is available
    try {
        $gitVersion = git --version
        Print "Git available: $gitVersion"
    } catch {
        PrintError "Git is not available. Please install Git to deploy to Hugging Face."
        exit 1
    }
    
    # Check if huggingface_hub is available
    try {
        $hfVersion = python -c "import huggingface_hub; print(huggingface_hub.__version__)"
        Print "Hugging Face Hub available: $hfVersion"
    } catch {
        PrintError "Hugging Face Hub not available. Installing..."
        pip install huggingface_hub
    }
    
    # Login to Hugging Face
    Print "Logging in to Hugging Face..."
    try {
        $env:HUGGINGFACE_HUB_TOKEN = $Token
        python -c "from huggingface_hub import login; login('$Token')"
        Print "Successfully logged in to Hugging Face"
    } catch {
        PrintError "Failed to login to Hugging Face: $_"
        exit 1
    }
    
    # Check if there are changes to commit
    Print "Checking for changes to commit..."
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Print "Found changes to commit:"
        $gitStatus | ForEach-Object { Print "  $_" }
        
        # Add all changes
        Print "Adding all changes..."
        git add .
        
        # Commit changes
        $commitMessage = "Refactored codebase - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        Print "Committing changes: $commitMessage"
        git commit -m $commitMessage
        
        # Push to Hugging Face
        Print "Pushing to Hugging Face Space..."
        try {
            $uploadResult = python -c "
import os
import sys
from huggingface_hub import HfApi
try:
    api = HfApi()
    result = api.upload_folder(
        folder_path='.',
        repo_id='$Owner/$SpaceName',
        repo_type='space',
        commit_message='$commitMessage'
    )
    print('SUCCESS: Successfully pushed to Hugging Face Space')
    sys.exit(0)
except Exception as e:
    print(f'ERROR: {str(e)}')
    sys.exit(1)
" 2>&1
            
            if ($LASTEXITCODE -ne 0) {
                PrintError "Failed to push to Hugging Face: $uploadResult"
                exit 1
            }
            Print "Successfully deployed to Hugging Face Space"
        } catch {
            PrintError "Failed to push to Hugging Face: $_"
            exit 1
        }
    } else {
        Print "No changes to commit. Skipping deployment."
    }
} else {
    Print "Skipping deployment (--SkipDeploy flag set)"
}

# Step 2: Wait for deployment to be ready
Print "=== Step 2: Waiting for deployment to be ready ==="
$maxWaitTime = 300 # 5 minutes
$waitStart = Get-Date
$deploymentReady = $false

while (-not $deploymentReady -and ((Get-Date) - $waitStart).TotalSeconds -lt $maxWaitTime) {
    try {
        Print "Checking if deployment is ready..."
        $health = Invoke-RestMethod "$BaseUrl/health" -Method GET -TimeoutSec 10
        if ($health.status -eq "ok") {
            $deploymentReady = $true
            Print "Deployment is ready!"
        }
    } catch {
        Print "Deployment not ready yet, waiting 10 seconds..."
        Start-Sleep -Seconds 10
    }
}

if (-not $deploymentReady) {
    PrintError "Deployment did not become ready within $maxWaitTime seconds"
    exit 1
}

# Step 3: Test health endpoint
Print "=== Step 3: Testing Health Endpoint ==="
try {
    $health = Invoke-RestMethod "$BaseUrl/health" -Method GET
    Print "Health check passed:"
    $health | ConvertTo-Json -Depth 6 | Write-Host
    
    # Validate health response
    $requiredFields = @("status", "worker_active", "db_ok", "yt_dlp_ok", "ffmpeg_ok")
    foreach ($field in $requiredFields) {
        if (-not $health.PSObject.Properties.Name -contains $field) {
            PrintError "Health response missing required field: $field"
            exit 1
        }
    }
    
    if ($health.status -ne "ok") {
        PrintError "Health status is not 'ok': $($health.status)"
        exit 1
    }
} catch {
    PrintError "Health check failed: $_"
    exit 1
}

# Step 4: Test job repair endpoint
Print "=== Step 4: Testing Job Repair ==="
try {
    $repairResult = Invoke-RestMethod "$BaseUrl/jobs/repair" -Method POST
    Print "Job repair completed:"
    $repairResult | ConvertTo-Json -Depth 6 | Write-Host
} catch {
    PrintError "Job repair failed: $_"
    exit 1
}

# Step 5: Test transcription pipeline
Print "=== Step 5: Testing Transcription Pipeline ==="
Print "Submitting transcription job for: $VideoUrl"

try {
    $transcribeBody = @{url=$VideoUrl} | ConvertTo-Json
    $resp = Invoke-RestMethod "$BaseUrl/transcribe" -Method POST -Body $transcribeBody -ContentType "application/json"
    $jobId = if ($resp.id) { $resp.id } else { $resp.job_id }
    Print "Job submitted successfully. Job ID: $jobId"
} catch {
    PrintError "Failed to submit transcription job: $_"
    exit 1
}

# Step 6: Monitor job progress
Print "=== Step 6: Monitoring Job Progress ==="
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$jobCompleted = $false
$lastStatus = ""

while (-not $jobCompleted -and (Get-Date) -lt $deadline) {
    try {
        Start-Sleep -Seconds 5
        $status = Invoke-RestMethod "$BaseUrl/transcribe/$jobId" -Method GET
        
        if ($status.status -ne $lastStatus) {
            Print "Status changed: $($lastStatus) -> $($status.status)"
            $lastStatus = $status.status
        }
        
        switch ($status.status) {
            "COMPLETE" {
                Print "✅ TRANSCRIPTION COMPLETED SUCCESSFULLY!"
                $status | ConvertTo-Json -Depth 8 | Write-Host
                
                # Validate completion response
                if ($status.data -and $status.data.text) {
                    Print "Transcript text length: $($status.data.text.Length) characters"
                    Print "First 100 characters: $($status.data.text.Substring(0, [Math]::Min(100, $status.data.text.Length)))"
                } elseif ($status.result -and $status.result.text) {
                    Print "Transcript text length: $($status.result.text.Length) characters"
                    Print "First 100 characters: $($status.result.text.Substring(0, [Math]::Min(100, $status.result.text.Length)))"
                }
                
                if ($status.transcript_url) {
                    Print "Transcript URL: $($status.transcript_url)"
                } elseif ($status.result -and $status.result.transcript_url) {
                    Print "Transcript URL: $($status.result.transcript_url)"
                }
                
                $jobCompleted = $true
            }
            "FAILED" {
                PrintError "❌ TRANSCRIPTION FAILED!"
                PrintError "Error code: $($status.code)"
                PrintError "Error message: $($status.message)"
                if ($status.error_message) {
                    PrintError "Detailed error: $($status.error_message)"
                }
                exit 1
            }
            default {
                # Continue monitoring
                $timeRemaining = [Math]::Max(0, ($deadline - (Get-Date)).TotalSeconds)
                Print "Status: $($status.status) (Time remaining: $([Math]::Round($timeRemaining))s)"
            }
        }
    } catch {
        PrintError "Failed to check job status: $_"
        exit 1
    }
}

if (-not $jobCompleted) {
    PrintError "❌ JOB DID NOT COMPLETE WITHIN TIMEOUT ($TimeoutSec seconds)"
    PrintError "Final status: $lastStatus"
    exit 1
}

# Step 7: Test additional endpoints
Print "=== Step 7: Testing Additional Endpoints ==="

# Test jobs summary
try {
    Print "Testing jobs summary..."
    $jobsSummary = Invoke-RestMethod "$BaseUrl/jobs" -Method GET
    Print "Jobs summary:"
    $jobsSummary | ConvertTo-Json -Depth 6 | Write-Host
} catch {
    PrintWarning "Jobs summary test failed: $_"
}

# Test failed jobs (should be empty)
try {
    Print "Testing failed jobs endpoint..."
    $failedJobs = Invoke-RestMethod "$BaseUrl/jobs/failed" -Method GET
    if ($failedJobs.jobs -and $failedJobs.jobs.Count -gt 0) {
        PrintWarning "Found $($failedJobs.jobs.Count) failed jobs"
    } else {
        Print "No failed jobs found (good!)"
    }
} catch {
    PrintWarning "Failed jobs test failed: $_"
}

Print "=== 🎉 ALL TESTS PASSED SUCCESSFULLY! ==="
Print "The TikTok Transcriber is working correctly end-to-end."
Print "Deployment URL: $BaseUrl"
Print "Test completed at: $(Get-Date)"



