# Operator Testing Guide

Use this guide to verify PromptImprover from a clean Windows operator session.

## Current Verified Baseline

This is the latest known-good baseline at the time this guide was updated:

| Evidence | Value |
|---|---|
| Date | 2026-06-23 |
| Branch | `master` |
| Commit | `abbff59cc6d62b734912e2a98c61ae3dc1d4c6b8` |
| GitHub CI run | `28030976193` |
| CI result | `success` |
| Local release gate | `npm.cmd run release:verify` passed |
| Local test count | 51 test files, 382 tests |
| Coverage | 100% statements, branches, functions, and lines |
| Local runtime health | `/api/health` returned `runtime.status: online` |
| Operator dashboard port | `3000` (`http://127.0.0.1:3000`) |
| Local semantic provider | `http://localhost:11434`, models `gemma3:12b` and `gemma3` |

Treat this table as evidence, not a permanent guarantee. When any product behavior changes, rerun the gate and update this baseline.

## Coverage Policy

Coverage is enforced by `universal-refiner/vitest.config.ts`:

| Metric | Required |
|---|---:|
| Statements | 100% |
| Branches | 100% |
| Functions | 100% |
| Lines | 100% |

The coverage include set is owned deterministic production logic under:

- `hooks/lib/**/*.ts`
- `src/**/*.ts`

The only current exclusion is generated version metadata:

- `src/core/generated-version.ts`

Do not lower coverage thresholds to merge a feature. If a defect is reproduced, add a regression test at the owning boundary before fixing or merging.

## Release Gate Matrix

| Gate | Command | Scope | CI job |
|---|---|---|---|
| Clean install | `npm ci` | Dependency graph from lockfile | All jobs |
| Build | `npm.cmd run build` | TypeScript and dashboard copy | All jobs |
| Coverage | `npm.cmd run test:coverage` | Unit and integration tests with 100% thresholds | `build-and-test`, `windows` |
| MCP acceptance | `npm.cmd run test:acceptance` | Advertised MCP tool schemas and dispatcher paths | `acceptance`, `windows` |
| Semantic fallback | `npm.cmd run acceptance:semantic` | local provider ordering, fallback, malformed response, timeout, outage | `acceptance`, `windows` |
| Tracked turn | `npm.cmd run acceptance:tracked-turn` | prompt ID and SQLite outcome linkage | `acceptance`, `windows` |
| Real stdio MCP | `npm.cmd run acceptance:stdio-mcp` | built `dist/src/index.js` over real MCP stdio, tool listing, and `lint_prompt` call | `acceptance`, `windows` |
| Dashboard browser E2E | `npm.cmd run test:e2e` | dashboard load, navigation, pulse bar, and proxy prompt stream rendering in Chromium | `dashboard-e2e`, local operator |
| Stress tests | `npm.cmd run test:stress` | concurrent and long-running behavior | `stress`, `windows` |
| EventStore stress | `npm.cmd run stress:event-store` | SQLite contention and multi-process behavior | `stress`, `windows` |
| Abrupt recovery | `npm.cmd run recovery:event-store:abrupt` | interrupted writer recovery | `stress`, `windows` |
| Soak | `npm.cmd run stress:event-store:soak` | long-duration EventStore behavior | `stress`, `windows` |
| Production audit | `npm.cmd run security:audit` | production dependency vulnerabilities, high or above | `supply-chain` |
| Full audit | `npm.cmd run security:audit:all` | production and development dependency vulnerabilities, high or above | `supply-chain` |
| Secret scan | `npm.cmd run security:secrets` | committed credential patterns | `supply-chain` |
| Package dry-run | `npm.cmd run package:check` | npm package contents | `supply-chain` |
| Package runtime | `npm.cmd run acceptance:package-runtime` | packed tarball install plus `/api/health` smoke | `supply-chain`, `windows` |
| Release gate | `npm.cmd run release:verify` | local aggregate of the gates above | local operator |
| CI release gate | GitHub Actions `release-gate` job | all enterprise jobs must pass before merge | `release-gate` |

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
- Real stdio MCP smoke lists tools and calls `lint_prompt`.
- Dashboard browser E2E passes in Chromium.
- EventStore stress, abrupt recovery, and soak pass.
- Production and full dependency audits report zero high-or-higher vulnerabilities.
- Secret scan passes.
- Package dry-run passes.
- `acceptance:package-runtime` installs the packed tarball into a temporary global prefix and serves `/api/health`.

Port policy:

- Operator dashboard/runtime: fixed to `3000`.
- Dashboard E2E: fixed to `3999` by default through `PROMPT_REFINER_E2E_PORT` so browser tests do not collide with an operator runtime.
- Package runtime smoke: intentionally uses an ephemeral random port to avoid CI and local conflicts. The `<port>` printed by that test is not the operator dashboard port and should not be copied into setup instructions.

If this command fails, do not bypass it. Fix the failing behavior or document an explicit, reviewed exception in this file and in `docs/enterprise-release-gates.md`.

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

Use the canonical Windows profile when testing global CLI configuration. This avoids the accented-profile drift that can make a CLI read stale user-level settings:

```powershell
$env:USERPROFILE = 'C:\Users\KimHarjamaki'
$env:HOME = 'C:\Users\KimHarjamaki'
$env:AZURE_CONFIG_DIR = 'C:\Users\KimHarjamaki\.azure'
```

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

On Windows, Obsidian MCP must be registered with `npx.cmd`, not `npx`. `npx` can resolve to the PowerShell shim (`npx.ps1`) and fail under the default execution policy.

Gemini can report MCP servers as disabled when the current folder is untrusted. Start Gemini from the repo once with `--skip-trust` or accept the workspace trust prompt. Gemini also requires its own auth setup (`GEMINI_API_KEY`, Vertex AI, or Gemini Code Assist) before a trusted full CLI session can start.

## 5. Verify Dashboard Runtime Health

Start or restart the local background runtime:

```powershell
$repo = 'C:\PersonalRepo\portfolio\Promptimprover\universal-refiner'
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'universal-refiner.*dist/src/index.js' -or $_.CommandLine -match 'universal-refiner.*dist\\src\\index.js') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$env:PROMPT_REFINER_BACKGROUND = 'true'
$env:PROMPT_REFINER_DASHBOARD_PORT = '3000'
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
Package runtime smoke passed: installed universal-refiner-8.0.0 and served /api/health on <port>.
```

This catches missing production dependencies that are hidden by the local workspace. The `<port>` value is intentionally ephemeral for test isolation; the operator dashboard remains fixed at `http://127.0.0.1:3000`.

## 8. Confirm GitHub CI

After pushing a branch and opening a pull request:

```powershell
gh pr checks <PR_NUMBER> --repo Coding-Autopilot-System/Promptimprover
gh run list --repo Coding-Autopilot-System/Promptimprover --branch <BRANCH_NAME> --limit 10
```

Expected result:

- `build-and-test` passes.
- Both acceptance matrix jobs pass.
- `dashboard-e2e` passes.
- `stress` passes.
- `windows` passes.
- `supply-chain` passes.
- `release-gate` passes.

Remote CI is the authoritative proof for Linux and Windows clean-checkout behavior.

## 9. Document New Tests

Every production feature or bug fix should update this guide when it changes how the product is verified.

Use this checklist:

- Add or update tests at the smallest useful boundary.
- Add acceptance or stress coverage for cross-process, CLI, MCP, SQLite, or packaging behavior.
- Update the release gate matrix when a new script becomes part of the release contract.
- Update the current verified baseline after the branch is merged and CI is green.
- Keep limitations explicit. A green gate proves declared checks passed; it does not prove unknown future failures are impossible.

## Known Limitations

- Live Gemma verification depends on a local or external OpenAI-compatible model endpoint. The deterministic release gate covers provider fallback without requiring the operator's live model server.
- MCP tool availability depends on the hosting client exposing a healthy MCP transport. If a live `lint_prompt` or refinement call closes its transport, restart the MCP runtime and rerun the global registration doctor before treating the CLI as healthy.
- External CLI hook behavior depends on each client supporting hooks and trusting the current workspace. Codex currently uses MCP-first operation rather than transparent prompt lifecycle interception.
- "100% coverage" means every currently included deterministic production line, branch, statement, and function is covered. It does not mean every possible integration, environment, timing, or future regression is impossible.
