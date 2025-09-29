param(
  [string]$Owner = "iamromeoly",
  [string]$SpaceName = "TTTranscibe",
  [string]$Token = "",
  [string]$Branch = "main",
  [string]$RemoteName = "origin",
  [switch]$AutoCommit = $true,
  [string]$CommitMessage = "CI deploy - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
)

$ErrorActionPreference = 'Stop'
function Print { param($m) Write-Host "[deploy] $m" -ForegroundColor Green }
function PrintError { param($m) Write-Host "[ERROR] $m" -ForegroundColor Red }
function PrintWarn { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Invoke-GitCmd {
  param([Parameter(Mandatory=$true)][string]$ArgLine)
  & cmd /c "git $ArgLine" | Out-Null
  return $LASTEXITCODE
}

# Sanity
try { $null = (& git --version) } catch { PrintError "Git not found"; exit 1 }
try { $null = git rev-parse --is-inside-work-tree 2>$null } catch { PrintError "Not a git repository"; exit 1 }

Print "Starting non-interactive deployment to Hugging Face Space"
Print "Owner: $Owner  Space: $SpaceName  Branch: $Branch"

# Auto-commit if needed
$status = git status --porcelain
if ($status) {
  if ($AutoCommit) { PrintWarn "Working tree has changes. Auto-committing before deploy."; git add -A; git commit -m $CommitMessage | Out-Null }
  else { PrintError "Working tree dirty. Commit or pass -AutoCommit"; $status | ForEach-Object { PrintWarn $_ }; exit 1 }
}

# Resolve branch
if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = (git rev-parse --abbrev-ref HEAD).Trim(); if (-not $Branch) { $Branch = 'main' } }

# Remote URL (token embedded for push only)
$Token = if ([string]::IsNullOrWhiteSpace($Token)) { $env:HUGGINGFACE_HUB_TOKEN } else { $Token }
if ([string]::IsNullOrWhiteSpace($Token)) { PrintError "Token not provided and HUGGINGFACE_HUB_TOKEN not set"; exit 1 }
$spaceGitUrl = "https://user:${Token}@huggingface.co/spaces/$Owner/$SpaceName.git"

# Configure remote safely
try {
  $targetRemote = $RemoteName
$existing = (& git remote get-url $RemoteName 2>$null)
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existing)) {
    if ($existing -match 'huggingface.co') { Print "Using existing remote '$RemoteName'" }
  else { $targetRemote = 'hf'; if ((& git remote get-url hf 2>$null)) { & git remote set-url hf $spaceGitUrl | Out-Null } else { & git remote add hf $spaceGitUrl | Out-Null } }
  } else { & git remote add $RemoteName $spaceGitUrl | Out-Null }
  $RemoteName = $targetRemote
} catch { PrintError "Failed to configure remote: $_"; exit 1 }

# Push with robust fallback (rebase → force-with-lease)
Print "Pushing branch '$Branch' to Hugging Face Space..."
$pushSucceeded = $false
if ((Invoke-GitCmd "push $RemoteName ${Branch}:${Branch} --follow-tags") -eq 0) { $pushSucceeded = $true }

if (-not $pushSucceeded) {
  PrintWarn "Push rejected. Attempting fetch + rebase, then retry..."
  [void](Invoke-GitCmd "fetch $RemoteName")

  # Temporarily move only local wrapper scripts to avoid rebase overwrite
  $moved = @()
  Get-ChildItem -Path scripts -Filter "*.local.ps1" -ErrorAction SilentlyContinue | ForEach-Object {
    $file = $_.FullName
    $trackedLocal = (& git ls-files --cached -- $file 2>$null)
    if ([string]::IsNullOrWhiteSpace($trackedLocal)) {
      try { Move-Item $file "$file.bak" -Force; $moved += "$file.bak" } catch {}
    }
  }

  & git diff --quiet 2>$null; if ($LASTEXITCODE -ne 0) { & git add -A; & git commit -m "chore(deploy): auto-commit before rebase" | Out-Null }
  & git diff --quiet --ignore-submodules=all 2>$null; $stashed = $false
  if ($LASTEXITCODE -ne 0 -or (& git ls-files --others --exclude-standard)) { & git stash push --include-untracked -m deploy-temp-stash | Out-Null; $stashed = $true }

  $rebaseOk = $true
  if ((Invoke-GitCmd "rebase $RemoteName/$Branch") -ne 0) { $rebaseOk = $false }
  if (-not $rebaseOk) {
    PrintWarn "Rebase conflicts → aborting and using force-with-lease"
    [void](Invoke-GitCmd "rebase --abort")
    [void](Invoke-GitCmd "fetch $RemoteName")
    if ((Invoke-GitCmd "push $RemoteName ${Branch}:${Branch} --follow-tags --force-with-lease") -eq 0) { $pushSucceeded = $true }
  } else {
    if ((Invoke-GitCmd "push $RemoteName ${Branch}:${Branch} --follow-tags") -eq 0) { $pushSucceeded = $true }
  }

  if ($stashed) { & git stash pop 2>&1 | Out-Null }
  foreach ($bak in $moved) { $orig = $bak -replace "\.bak$",""; try { Move-Item $bak $orig -Force } catch {} }
}

if (-not $pushSucceeded) { PrintError "Deployment failed to push. Resolve local changes and try again. If the Space still rejects pushes citing offending files, purge secret history or push a clean branch as documented."; exit 1 }

Print "Deployment succeeded."
Print "Space URL: https://$Owner-$SpaceName.hf.space"
Print "Repo URL: https://huggingface.co/spaces/$Owner/$SpaceName"


