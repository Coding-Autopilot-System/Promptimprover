$script = Join-Path $PSScriptRoot "dashboard\View-SwarmDashboard.ps1"
if (Test-Path $script) {
    powershell -NoProfile -ExecutionPolicy Bypass -File $script
} else {
    Write-Host "Dashboard script not found at $script" -ForegroundColor Red
}
