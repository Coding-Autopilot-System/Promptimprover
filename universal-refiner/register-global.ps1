[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Apply,
    [string]$ProfileRoot = "C:\Users\KimHarjamaki",
    [string]$CodexHome,
    [string]$ObsidianVaultPath = "C:\repo\global.obsidian"
)

$operation = Join-Path $PSScriptRoot "scripts\operations\register-global.ps1"
& $operation @PSBoundParameters
exit $LASTEXITCODE
