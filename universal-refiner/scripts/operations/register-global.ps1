[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Apply,
    [string]$ProfileRoot = "C:\Users\KimHarjamaki",
    [string]$CodexHome,
    [string]$ObsidianVaultPath = "C:\repo\global.obsidian"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Check -and $Apply) {
    throw "Choose either -Check or -Apply."
}
if (-not $Check -and -not $Apply) {
    $Check = $true
}

$script:Changed = $false
$script:Issues = New-Object System.Collections.Generic.List[string]
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
}

function ConvertTo-ConfigPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Resolve-NormalizedPath $Path).Replace("\", "/")
}

function ConvertTo-OrderedObject {
    param($Value)

    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $result = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) {
            $result[$property.Name] = ConvertTo-OrderedObject $property.Value
        }
        return $result
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $result = [ordered]@{}
        foreach ($key in $Value.Keys) {
            $result[$key] = ConvertTo-OrderedObject $Value[$key]
        }
        return $result
    }
    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
        return ,@($Value | ForEach-Object { ConvertTo-OrderedObject $_ })
    }
    return $Value
}

function ConvertTo-StableJson {
    param([Parameter(Mandatory = $true)]$Value)

    return ((ConvertTo-OrderedObject $Value) | ConvertTo-Json -Depth 100) + [Environment]::NewLine
}

function Test-Mojibake {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

    return $Text -match "\uFFFD|\u00C2|\u00C3|\u00E2[\u0080-\u00BF]"
}

function Find-PlaintextCredentialFields {
    param(
        $Value,
        [string]$Path = "`$"
    )

    if ($null -eq $Value) { return }
    if (($Value -is [System.Collections.IDictionary]) -or ($Value -is [System.Management.Automation.PSCustomObject])) {
        $entries = if ($Value -is [System.Collections.IDictionary]) {
            @($Value.Keys | ForEach-Object { [pscustomobject]@{ Name = $_; Value = $Value[$_] } })
        } else {
            @($Value.PSObject.Properties | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Value = $_.Value } })
        }
        foreach ($entry in $entries) {
            $key = $entry.Name
            $fieldPath = "$Path.$key"
            $item = $entry.Value
            if ($key -match "(?i)(api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|credential|authorization|bearer)" -and
                $item -is [string] -and -not [string]::IsNullOrWhiteSpace($item) -and
                $item -notmatch "^\$\{[A-Za-z_][A-Za-z0-9_]*\}$") {
                $script:Issues.Add("plaintext credential field: $fieldPath")
            }
            Find-PlaintextCredentialFields $item $fieldPath
        }
        return
    }
    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
        $index = 0
        foreach ($item in $Value) {
            Find-PlaintextCredentialFields $item "$Path[$index]"
            $index++
        }
    }
}

function Read-JsonConfig {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return [ordered]@{}
    }
    $text = [System.IO.File]::ReadAllText($Path)
    if (Test-Mojibake $text) {
        $script:Issues.Add("mojibake detected: $Path")
    }
    if ([string]::IsNullOrWhiteSpace($text)) {
        return [ordered]@{}
    }
    try {
        $config = ConvertTo-OrderedObject ($text | ConvertFrom-Json)
        Find-PlaintextCredentialFields $config
        return $config
    } catch {
        $script:Issues.Add("invalid JSON: $Path")
        throw "Cannot safely merge invalid JSON config: $Path"
    }
}

function Backup-Config {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    Copy-Item -LiteralPath $Path -Destination "$Path.promptimprover-backup-$stamp" -Force
}

function Write-AtomicUtf8 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    Backup-Config $Path
    $temporaryPath = Join-Path $directory (".{0}.{1}.tmp" -f ([System.IO.Path]::GetFileName($Path)), [Guid]::NewGuid().ToString("N"))
    $replaceBackupPath = "$temporaryPath.replace-backup"
    try {
        [System.IO.File]::WriteAllText($temporaryPath, $Content, $script:Utf8NoBom)
        if (Test-Path -LiteralPath $Path) {
            [System.IO.File]::Replace($temporaryPath, $Path, $replaceBackupPath)
        } else {
            Move-Item -LiteralPath $temporaryPath -Destination $Path
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if (Test-Path -LiteralPath $replaceBackupPath) {
            Remove-Item -LiteralPath $replaceBackupPath -Force
        }
    }
}

function Set-MapValue {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Map,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Value
    )

    $Map[$Name] = ConvertTo-OrderedObject $Value
}

function Merge-Hooks {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Config,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$DesiredHooks
    )

    if (-not $Config.Contains("hooks") -or -not ($Config["hooks"] -is [System.Collections.IDictionary])) {
        $Config["hooks"] = [ordered]@{}
    }
    foreach ($eventName in $DesiredHooks.Keys) {
        $existing = @($Config["hooks"][$eventName] | Where-Object { $null -ne $_ })
        $desired = @($DesiredHooks[$eventName])
        foreach ($entry in $desired) {
            $desiredCommands = @($entry["hooks"] | ForEach-Object { $_["command"] } | Where-Object { $_ -like "promptimprover-hook-*" })
            if ($desiredCommands.Count -gt 0) {
                $existing = @($existing | Where-Object {
                    $candidateCommands = @($_["hooks"] | ForEach-Object { $_["command"] })
                    -not ($candidateCommands | Where-Object { $desiredCommands -contains $_ })
                })
            }
            $fingerprint = $entry | ConvertTo-Json -Depth 100 -Compress
            $existingFingerprints = @($existing | ForEach-Object { $_ | ConvertTo-Json -Depth 100 -Compress })
            if ($existingFingerprints -notcontains $fingerprint) {
                $existing += ,(ConvertTo-OrderedObject $entry)
            }
        }
        $Config["hooks"][$eventName] = $existing
    }
}

function Update-JsonConfig {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Servers,
        [System.Collections.IDictionary]$Hooks
    )

    $config = Read-JsonConfig $Path
    $originalFingerprint = $config | ConvertTo-Json -Depth 100 -Compress
    if ($Servers.Count -gt 0) {
        if (-not $config.Contains("mcpServers") -or -not ($config["mcpServers"] -is [System.Collections.IDictionary])) {
            $config["mcpServers"] = [ordered]@{}
        }
        foreach ($serverName in $Servers.Keys) {
            Set-MapValue $config["mcpServers"] $serverName $Servers[$serverName]
        }
    }
    if ($null -ne $Hooks) {
        Merge-Hooks $config $Hooks
    }

    $desiredContent = ConvertTo-StableJson $config
    $desiredFingerprint = $config | ConvertTo-Json -Depth 100 -Compress
    $currentContent = if (Test-Path -LiteralPath $Path) { [System.IO.File]::ReadAllText($Path) } else { "" }
    if (($currentContent -ceq $desiredContent) -or ($originalFingerprint -ceq $desiredFingerprint)) {
        Write-Host "OK      $Name"
        return
    }

    $script:Changed = $true
    if ($Apply) {
        Write-AtomicUtf8 $Path $desiredContent
        Write-Host "UPDATED $Name"
    } else {
        Write-Host "DRIFT   $Name"
    }
}

function ConvertTo-TomlString {
    param([Parameter(Mandatory = $true)][string]$Value)

    return '"' + $Value.Replace("\", "\\").Replace('"', '\"') + '"'
}

function Set-TomlSection {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory = $true)][string]$SectionName,
        [Parameter(Mandatory = $true)][string[]]$Lines
    )

    $section = "[$SectionName]`r`n" + (($Lines -join "`r`n") + "`r`n")
    $escaped = [regex]::Escape("[$SectionName]")
    $pattern = "(?ms)^$escaped\s*\r?\n.*?(?=^\[|\z)"
    if ($Content -match $pattern) {
        return [regex]::Replace($Content, $pattern, $section)
    }
    if (-not [string]::IsNullOrWhiteSpace($Content) -and -not $Content.EndsWith("`n")) {
        $Content += "`r`n"
    }
    return $Content + $section
}

function Inspect-TomlConfig {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $content = [System.IO.File]::ReadAllText($Path)
    if (Test-Mojibake $content) {
        $script:Issues.Add("mojibake detected: $Path")
    }
    foreach ($match in [regex]::Matches($content, '(?im)^\s*([A-Za-z0-9_.-]*(?:key|token|secret|password|credential|authorization|bearer)[A-Za-z0-9_.-]*)\s*=\s*(?!"\$\{)[^#\r\n]+')) {
        $script:Issues.Add("plaintext credential field: `$.$($match.Groups[1].Value)")
    }
}

function Update-CodexConfig {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Servers
    )

    $content = if (Test-Path -LiteralPath $Path) { [System.IO.File]::ReadAllText($Path) } else { "" }

    $desiredContent = $content
    foreach ($serverName in $Servers.Keys) {
        $server = $Servers[$serverName]
        $arguments = @($server.args | ForEach-Object { ConvertTo-TomlString $_ }) -join ", "
        $desiredContent = Set-TomlSection $desiredContent "mcp_servers.$serverName" @(
            "command = $(ConvertTo-TomlString $server.command)",
            "args = [$arguments]"
        )
    }
    if (-not $desiredContent.EndsWith("`n")) {
        $desiredContent += "`r`n"
    }

    if ($content -ceq $desiredContent) {
        Write-Host "OK      Codex"
        return
    }
    $script:Changed = $true
    if ($Apply) {
        Write-AtomicUtf8 $Path $desiredContent
        Write-Host "UPDATED Codex"
    } else {
        Write-Host "DRIFT   Codex"
    }
}

$profile = Resolve-NormalizedPath $ProfileRoot
$repoRoot = Resolve-NormalizedPath (Join-Path $PSScriptRoot "..\..")
$serverPath = ConvertTo-ConfigPath (Join-Path $repoRoot "dist\src\index.js")
$vaultPath = ConvertTo-ConfigPath $ObsidianVaultPath
$isWindowsHost = $env:OS -eq "Windows_NT" -or [System.IO.Path]::DirectorySeparatorChar -eq "\"
$npxCommand = if ($isWindowsHost) { "npx.cmd" } else { "npx" }

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
    if (-not $PSBoundParameters.ContainsKey("ProfileRoot") -and -not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
        $CodexHome = $env:CODEX_HOME
    } else {
        $CodexHome = Join-Path $profile ".codex"
    }
}
$codexRoot = Resolve-NormalizedPath $CodexHome

$servers = [ordered]@{
    "prompt-refiner" = [ordered]@{
        command = "node"
        args = @($serverPath)
    }
    "obsidian" = [ordered]@{
        command = $npxCommand
        args = @("-y", "@bitbonsai/mcpvault@latest", $vaultPath)
    }
}

$claudeHooks = Read-JsonConfig (Join-Path $repoRoot "hooks\config\claude.settings.fragment.json")
$geminiHooks = Read-JsonConfig (Join-Path $repoRoot "hooks\config\gemini.settings.fragment.json")

Write-Host "Mode: $(if ($Apply) { 'Apply' } else { 'Check' })"
Write-Host "Profile: $profile"
Write-Host "Checkout: $repoRoot"

$codexConfigPath = Join-Path $codexRoot "config.toml"
$claudeMcpPath = Join-Path $profile ".claude.json"
$claudeSettingsPath = Join-Path $profile ".claude\settings.json"
$geminiSettingsPath = Join-Path $profile ".gemini\settings.json"

try {
    Inspect-TomlConfig $codexConfigPath
    [void](Read-JsonConfig $claudeMcpPath)
    [void](Read-JsonConfig $claudeSettingsPath)
    [void](Read-JsonConfig $geminiSettingsPath)
} catch {
    Write-Warning $_.Exception.Message
    exit 2
}

if ($Apply -and $script:Issues.Count -gt 0) {
    foreach ($issue in $script:Issues | Select-Object -Unique) {
        Write-Warning $issue
    }
    Write-Warning "Apply refused because preflight diagnostics must be resolved first."
    exit 2
}

try {
    Update-CodexConfig $codexConfigPath $servers
    Update-JsonConfig "Claude Code MCP" $claudeMcpPath $servers
    Update-JsonConfig "Claude Code hooks" $claudeSettingsPath ([ordered]@{}) $claudeHooks["hooks"]
    Update-JsonConfig "Gemini" $geminiSettingsPath $servers $geminiHooks["hooks"]
} catch {
    Write-Warning $_.Exception.Message
    exit 2
}

foreach ($issue in $script:Issues | Select-Object -Unique) {
    Write-Warning $issue
}

if ($script:Issues.Count -gt 0) {
    exit 2
}
if ($Check -and $script:Changed) {
    exit 1
}
exit 0
