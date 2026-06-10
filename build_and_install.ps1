[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$packageDir = Join-Path $PSScriptRoot 'universal-refiner'

Write-Host 'Validating and installing Universal Refiner...' -ForegroundColor Cyan
Push-Location $packageDir
try {
    npm ci --no-fund
    npm test
    npm run build
    npm install --global . --no-fund

    $package = Get-Content .\package.json -Raw | ConvertFrom-Json
    $command = Get-Command gemini-prompt-refiner -ErrorAction Stop
    Write-Host "Prompt Refiner v$($package.version) installed: $($command.Source)" -ForegroundColor Green
}
finally {
    Pop-Location
}