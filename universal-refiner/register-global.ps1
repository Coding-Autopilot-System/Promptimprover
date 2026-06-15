[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Apply,
    [string]$ProfileRoot = ("C:\Users\KimHarjam{0}ki" -f [char]0x00E4),
    [string]$CodexHome,
    [string]$ObsidianVaultPath = "C:\repo\global.obsidian"
)

$operation = Join-Path $PSScriptRoot "scripts\operations\register-global.ps1"
& $operation @PSBoundParameters
exit $LASTEXITCODE
