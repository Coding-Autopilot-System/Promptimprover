Write-Host "Starting Universal Build & Install..." -ForegroundColor Cyan

cd universal-refiner
npm install
npm run build
npm install -g .

$package = Get-Content .\package.json | ConvertFrom-Json
$version = $package.version

Write-Host "Prompt Refiner v$version installed globally as 'gemini-prompt-refiner'" -ForegroundColor Green
Write-Host "Use 'gemini-prompt-refiner' command in your MCP configurations." -ForegroundColor Yellow
