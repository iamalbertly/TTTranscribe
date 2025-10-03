Param(
    [string]$Url = "https://vm.tiktok.com/ZMADQVF4e/",
    [string]$ApiKey = $env:API_KEY,
    [string]$ApiSecret = $env:API_SECRET
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ApiKey -or -not $ApiSecret) {
    Write-Host "API_KEY and API_SECRET must be provided (param or env)."
    exit 2
}

Write-Host "[local] Running unified e2e test via scripts/test_e2e.py"
python scripts/test_e2e.py --local --url $Url --key $ApiKey --secret $ApiSecret --start-local --env "API_SECRET=$ApiSecret" --env "API_KEYS_JSON={`"$ApiKey`":`"local`"}"


