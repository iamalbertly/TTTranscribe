# TTTranscibe_E2E_Utils.ps1
# Shared utilities for E2E tests: logging, signing, helpers

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function TT_LogInfo { param([Parameter(ValueFromRemainingArguments=$true)]$Args) Write-Host $Args -ForegroundColor Cyan }
function TT_LogWarn { param([Parameter(ValueFromRemainingArguments=$true)]$Args) Write-Host $Args -ForegroundColor Yellow }
function TT_LogError { param([Parameter(ValueFromRemainingArguments=$true)]$Args) Write-Host $Args -ForegroundColor Red }
function TT_LogOk { param([Parameter(ValueFromRemainingArguments=$true)]$Args) Write-Host $Args -ForegroundColor Green }

function TT_NewHMACSignature {
    param(
        [Parameter(Mandatory=$true)][string]$Secret,
        [Parameter(Mandatory=$true)][string]$Method,
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Body,
        [Parameter(Mandatory=$true)][int64]$Timestamp
    )
    $stringToSign = "$Method`n$Path`n$Body`n$Timestamp"
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($Secret))
    try {
        ([System.BitConverter]::ToString($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($stringToSign))).Replace('-', '')).ToLower()
    } finally {
        $hmac.Dispose()
    }
}

function TT_UnixMs { ([int64]((Get-Date).ToUniversalTime() - (Get-Date '1970-01-01 00:00:00')).TotalMilliseconds) }




