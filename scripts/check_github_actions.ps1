# Check latest GitHub Actions run for the repository
try {
  $url = 'https://api.github.com/repos/iamalbertly/TTTranscribe/actions/runs?per_page=1'
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -ErrorAction Stop
  $json = $resp.Content | ConvertFrom-Json
  if ($json.workflow_runs.Count -gt 0) {
    $run = $json.workflow_runs[0]
    Write-Output "Latest run: $($run.name) Status: $($run.status) Conclusion: $($run.conclusion)"
    Write-Output "URL: $($run.html_url)"
  } else {
    Write-Output 'No workflow runs found.'
  }
} catch {
  Write-Output "Failed to query GitHub Actions API: $_"
  exit 1
}
