Param(
    [int[]]$Ports = @(8000, 7860),
    [int]$ErrorTail = 200
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Print {
    param([string]$m)
    Write-Host "[kill] $m"
}

function Stop-PortListeners {
    param([int[]]$Ports)
    $killed = @()
    foreach ($p in $Ports) {
        try {
            $conns = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
            if ($conns) {
                $pids = $conns.OwningProcess | Sort-Object -Unique
                foreach ($procId in $pids) {
                    try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; $killed += $procId } catch {}
                }
                if ($pids) { Print "Killed PIDs listening on port ${p}: $($pids -join ', ')" } else { Print "No PIDs to kill on port ${p}" }
            } else {
                Print "No listeners on port $p"
            }
        } catch { Print "Error checking port ${p}: $($_.Exception.Message)" }
    }
    return $killed | Sort-Object -Unique
}

function Stop-AppProcessesPathScoped {
    $root = (Resolve-Path "$PSScriptRoot/../").Path
    $procs = Get-Process python,uvicorn -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -like ("$root*") } catch { $false }
    }
    $killed = @()
    foreach ($p in $procs) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $killed += $p.Id } catch {} }
    if ($killed.Count -gt 0) { Print "Killed repo-scoped PIDs: $($killed -join ', ')" } else { Print "No repo-scoped python/uvicorn to kill" }
}

function Show-RecentErrorsFromLog {
    param([int]$Tail)
    $logPath = Join-Path ((Resolve-Path "$PSScriptRoot/../").Path) 'server.log'
    if (-not (Test-Path $logPath)) { Print "No server.log found at $logPath"; return }
    Print "Recent errors and warnings from server.log (last $Tail lines):"
    $lines = Get-Content -Path $logPath -Tail $Tail -ErrorAction SilentlyContinue
    if (-not $lines) { Print "No log lines to show"; return }
    $shown = $false
    foreach ($line in $lines) {
        # Try parse JSON; fallback to raw
        try { $obj = $line | ConvertFrom-Json -ErrorAction Stop } catch { $obj = $null }
        if ($obj -and $obj.level) {
            if ($obj.level -in @('ERROR','WARNING')) { $shown = $true; $obj | ConvertTo-Json -Compress | Write-Host }
        } elseif ($line -match 'ERROR|WARNING') { $shown = $true; Write-Host $line }
    }
    if (-not $shown) { Print "No ERROR/WARNING found in last $Tail lines; showing tail:"; $lines | ForEach-Object { Write-Host $_ } }
}

try {
    Print "Stopping listeners on ports: $($Ports -join ', ')"
    $null = Stop-PortListeners -Ports $Ports
    Stop-AppProcessesPathScoped
    Show-RecentErrorsFromLog -Tail $ErrorTail
    Print "Done."
} catch {
    Write-Host "[kill] Failed: $($_.Exception.Message)"
    exit 1
}


