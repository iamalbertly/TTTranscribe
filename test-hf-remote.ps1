#!/usr/bin/env pwsh
# Test remote HF Space API endpoints

param(
  [string]$BaseUrl = "https://iamromeoly-tttranscribe.hf.space",
  [string]$AuthSecret = "hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU"
)

Write-Host "Testing HF Space API endpoints at: $BaseUrl" -ForegroundColor Cyan
$headers = @{ 'X-Engine-Auth' = $AuthSecret; 'Content-Type' = 'application/json' }

# Test 1: Health check
Write-Host "`n1. Testing /health endpoint..." -ForegroundColor Yellow
try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Headers $headers -TimeoutSec 30
  Write-Host "✓ Health check passed" -ForegroundColor Green
  Write-Output $health | ConvertTo-Json -Depth 3
} catch {
  Write-Host "✗ Health check failed: $_" -ForegroundColor Red
}

# Test 2: Submit transcription
Write-Host "`n2. Submitting transcription request..." -ForegroundColor Yellow
try {
  $body = @{ url = "https://vm.tiktok.com/ZMAKpqkpN/" } | ConvertTo-Json
  $response = Invoke-RestMethod -Uri "$BaseUrl/transcribe" -Method Post -Body $body -Headers $headers -TimeoutSec 30
  Write-Host "✓ Transcription submitted" -ForegroundColor Green
  Write-Output $response | ConvertTo-Json -Depth 3
  
  $jobId = $response.id
  
  # Test 3: Poll status
  Write-Host "`n3. Polling job status (jobId: $jobId)..." -ForegroundColor Yellow
  $attempts = 0
  $maxAttempts = 40
  $completed = $false
  
  while ($attempts -lt $maxAttempts -and -not $completed) {
    try {
      $status = Invoke-RestMethod -Uri "$BaseUrl/status/$jobId" -Headers $headers -TimeoutSec 30
      Write-Host "Attempt $($attempts + 1)/$maxAttempts - Status: $($status.status) Progress: $($status.progress)% Phase: $($status.currentStep)" -ForegroundColor Cyan
      
      if ($status.status -eq 'completed' -or $status.status -eq 'failed') {
        Write-Host "`n✓ Job completed with status: $($status.status)" -ForegroundColor Green
        Write-Output $status | ConvertTo-Json -Depth 5
        $completed = $true
      } else {
        $attempts++
        if ($attempts -gt 10) {
          Start-Sleep -Seconds 5
        } else {
          Start-Sleep -Seconds 2
        }
      }
    } catch {
      Write-Host "Error polling status: $_" -ForegroundColor Red
      $completed = $true
    }
  }
  
  if (-not $completed) {
    Write-Host "Job did not complete within $($maxAttempts * 3) seconds" -ForegroundColor Yellow
  }
} catch {
  Write-Host "✗ Transcription request failed: $_" -ForegroundColor Red
}

Write-Host "`nTest complete." -ForegroundColor Cyan
