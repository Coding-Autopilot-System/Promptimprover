# Operator Testing Guide

Use this guide to verify PromptImprover from a clean Windows operator session.

## 1. Enter The Active Package

```powershell
cd C:\PersonalRepo\portfolio\Promptimprover\universal-refiner
```

## 2. Run The Full Release Gate

```powershell
npm.cmd run release:verify
```

Expected result:

- TypeScript build passes.
- Vitest coverage reports 100% statements, branches, functions, and lines.
- MCP tool acceptance passes.
- Semantic fallback acceptance passes.
- Tracked-turn acceptance links a `prm_...` prompt ID in SQLite.
- EventStore stress, abrupt recovery, and soak pass.
- Production and full dependency audits report zero high-or-higher vulnerabilities.
- Secret scan passes.
- Package dry-run passes.
- `acceptance:package-runtime` installs the packed tarball into a temporary global prefix and serves `/api/health`.

## 3. Check Global MCP Registration

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-global.ps1 -Check -ProfileRoot C:\Users\KimHarjamaki -CodexHome C:\codex-home
```

Expected result:

```text
OK      Codex
OK      Claude Code MCP
OK      Claude Code hooks
OK      Gemini
```

If any row reports `DRIFT`, run `-Apply` only after confirming the drift is expected:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-global.ps1 -Apply -ProfileRoot C:\Users\KimHarjamaki -CodexHome C:\codex-home
```

## 4. List MCP Servers In Each CLI

```powershell
codex.cmd mcp list | Select-String -Pattern 'prompt-refiner|obsidian|Connected|enabled'
claude.cmd mcp list | Select-String -Pattern 'prompt-refiner|obsidian|Connected|Configured'
gemini.cmd mcp list | Select-String -Pattern 'prompt-refiner|obsidian|Connected|Configured'
```

Expected result:

- Codex lists `prompt-refiner` and `obsidian` as enabled.
- Claude lists `prompt-refiner` and `obsidian` as connected.
- Gemini lists `prompt-refiner` and `obsidian` as connected.

Codex may show `Unsupported` in the status column for stdio MCP entries. Treat the registration doctor as the authoritative config drift check.

## 5. Verify Dashboard Runtime Health

Start or restart the local background runtime:

```powershell
$repo = 'C:\PersonalRepo\portfolio\Promptimprover\universal-refiner'
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'universal-refiner.*dist/src/index.js' -or $_.CommandLine -match 'universal-refiner.*dist\\src\\index.js') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$env:PROMPT_REFINER_BACKGROUND = 'true'
Start-Process -WindowStyle Hidden -FilePath node -ArgumentList (Join-Path $repo 'dist\src\index.js') -WorkingDirectory $repo
```

Check health:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health | ConvertTo-Json -Depth 6
```

Expected result:

- `runtime.status` is `online`.
- `semantic.local.enabled` is `true`.
- `semantic.local.models` includes `gemma3:12b` and `gemma3:1b`.

## 6. Verify Live Gemma Integration

```powershell
$env:PROMPT_REFINER_ACCEPTANCE_BASE_URL = 'http://localhost:9000/v1'
npm.cmd run acceptance:gemma:live
```

Expected result:

```text
Live semantic acceptance passed for gemma3:12b and gemma3:1b at http://localhost:9000/v1.
Semantic acceptance passed: gemma3:12b -> gemma3:1b and outage provider fallback.
```

Warnings such as `HTTP 503` for `gemma3:12b` and `fetch failed` during the outage section are expected. They prove fallback and outage paths are being exercised. The command must still exit successfully.

## 7. Verify Packaged Runtime Directly

```powershell
npm.cmd run acceptance:package-runtime
```

Expected result:

```text
Package runtime smoke passed: installed gemini-prompt-refiner-8.0.0 and served /api/health on <port>.
```

This catches missing production dependencies that are hidden by the local workspace.

## 8. Confirm GitHub CI

After pushing a branch and opening a pull request:

```powershell
gh pr checks <PR_NUMBER> --repo Coding-Autopilot-System/Promptimprover
gh run list --repo Coding-Autopilot-System/Promptimprover --branch <BRANCH_NAME> --limit 10
```

Expected result:

- `build-and-test` passes.
- Both acceptance matrix jobs pass.
- `stress` passes.
- `windows` passes.
- `supply-chain` passes.
- `release-gate` passes.

Remote CI is the authoritative proof for Linux and Windows clean-checkout behavior.
