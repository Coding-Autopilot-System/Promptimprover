# Global AI Agent Registration Script
# Targets: Claude Desktop, Codex CLI/App, Gemini CLI

$serverCommand = "node"
$serverPath = "C:/repo/Promptimprover/universal-refiner/dist/src/index.js"

# 1. Claude Desktop
$claudePath = "$env:APPDATA\Claude\claude_desktop_config.json"
if (Test-Path $claudePath) {
    Write-Host "Registering in Claude Desktop..." -ForegroundColor Cyan
    $config = Get-Content $claudePath | ConvertFrom-Json
    if (-not $config.mcpServers) { $config | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value @{} }
    $config.mcpServers | Add-Member -MemberType NoteProperty -Name "universal-refiner" -Value @{ command = $serverCommand; args = @($serverPath) } -Force
    $config | ConvertTo-Json -Depth 10 | Set-Content $claudePath
}

# 2. Codex (config.toml)
$codexPath = "$HOME\.codex\config.toml"
if (Test-Path $codexPath) {
    Write-Host "Registering in Codex..." -ForegroundColor Cyan
    $content = Get-Content $codexPath -Raw
    if ($content -notmatch "\[mcp_servers\.universal-refiner\]") {
        $codexEntry = @"

[mcp_servers.universal-refiner]
command = "$serverCommand"
args = ["$serverPath"]
"@
        Add-Content $codexPath $codexEntry
    }
}

# 3. Gemini CLI (global)
$geminiGlobalDir = "$HOME\.gemini"
if (-not (Test-Path $geminiGlobalDir)) { New-Item -Path $geminiGlobalDir -ItemType Directory -Force }
$geminiConfigPath = "$geminiGlobalDir\gemini-extension.json"
Write-Host "Registering in Global Gemini Config..." -ForegroundColor Cyan
$geminiEntry = @{
    name = "universal-refiner"
    version = "9.0.0"
    mcpServers = @{
        "universal-refiner" = @{
            command = $serverCommand
            args = @($serverPath)
        }
    }
}
$geminiEntry | ConvertTo-Json -Depth 10 | Set-Content $geminiConfigPath

Write-Host "DONE! Universal Refiner registered globally for Claude, Codex, and Gemini." -ForegroundColor Green
Write-Host "Please restart your AI apps to apply changes." -ForegroundColor Yellow
