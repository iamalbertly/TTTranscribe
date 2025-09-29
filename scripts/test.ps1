Param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& .\.venv\Scripts\Activate.ps1
pytest -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }


