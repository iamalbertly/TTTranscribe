Param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& .\.venv\Scripts\Activate.ps1

$proc = Start-Process powershell -ArgumentList "-NoProfile -Command uvicorn app.api.main:app --reload" -PassThru
Start-Sleep -Seconds 3

try {
  $health = Invoke-RestMethod -Uri http://localhost:8000/health -Method GET -TimeoutSec 10
  if (-not $health.status -or $health.status -ne 'ok' -or -not $health.worker_active) { throw "health not ok" }
  Write-Host "Health OK worker_active=$($health.worker_active)"

  $body = @{ url = 'https://www.tiktok.com/@scout2015/video/6718335390845095173' } | ConvertTo-Json
  $resp = Invoke-RestMethod -Uri http://localhost:8000/transcribe -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
  if ($resp.StatusCode -and $resp.StatusCode -eq 429) { Write-Host "Rate limited"; exit 0 }
  if (-not $resp.job_id) { throw "no job_id" }
  $job = $resp.job_id
  Write-Host "Job $job started"

  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $jr = Invoke-RestMethod -Uri ("http://localhost:8000/transcribe/$job") -Method GET -TimeoutSec 10 -SkipHttpErrorCheck
    if ($jr.status -eq 'COMPLETE') {
      $cache = $jr.data.cache_hit
      Write-Host "Complete CACHE_HIT:$cache"
      break
    }
    if ($jr.status -eq 'FAILED' -or $jr.code) { throw "Failed: $($jr.code) $($jr.message)" }
    Write-Host "Status: $($jr.status)"
  }
  if (-not $jr -or $jr.status -ne 'COMPLETE') { throw "Timeout waiting for completion" }

  # Repost same URL to assert cache hit
  $resp2 = Invoke-RestMethod -Uri http://localhost:8000/transcribe -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
  $job2 = $resp2.job_id
  $deadline2 = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline2) {
    Start-Sleep -Seconds 2
    $jr2 = Invoke-RestMethod -Uri ("http://localhost:8000/transcribe/$job2") -Method GET -TimeoutSec 10 -SkipHttpErrorCheck
    if ($jr2.status -eq 'COMPLETE') {
      if (-not $jr2.data.cache_hit) { throw "Expected CACHE_HIT:true" }
      Write-Host "Second Complete CACHE_HIT:$($jr2.data.cache_hit)"; break
    }
  }
}
finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}


