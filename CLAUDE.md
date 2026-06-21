# PromptImprover

MCP server middleware for prompt governance. The active implementation is the Universal Refiner package, which provides prompt refinement, local memory, commit-correlated learning, dashboard review workflows, and evidence capture for agent runs.

## Project Hierarchy

This project has a `context.md` tree. Always read the nearest context file before changing files in a directory.

- Root: `context.md` - project-wide mandates and submodule index.
- `universal-refiner/context.md` - active MCP server, refinement engine, history, learning, hooks, and dashboard.
- `gemini-extension/context.md` - Gemini CLI integration.
- `mcp-server/context.md` - legacy standalone MCP server.
- `docs/context.md` - architecture specs, roadmaps, and release-gate documentation.
- `archive/context.md` - deprecated code and historical experiments.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript, strict mode |
| Runtime | Node.js >= 22 |
| MCP transport | stdio via `@modelcontextprotocol/sdk` |
| Storage | SQLite via `better-sqlite3` |
| Build | `tsc` plus dashboard asset copy |
| Test | Vitest |

## Active Entry Points

| Path | Purpose |
|---|---|
| `universal-refiner/src/` | Active source code |
| `universal-refiner/dist/src/index.js` | Built MCP server used by global CLI registrations |
| `universal-refiner/hooks/` | Claude/Gemini hook runtime and fragments |
| `universal-refiner/scripts/operations/register-global.ps1` | Global Codex, Claude, and Gemini registration doctor |
| `universal-refiner/scripts/acceptance/` | Real-process and package-runtime acceptance gates |

## Standard Workflow

1. Read the relevant `context.md`, `AGENTS.md`, `GEMINI.md`, and this file before changing behavior.
2. Prefer the active `universal-refiner` package for new work. Avoid expanding legacy `mcp-server` unless the task explicitly targets it.
3. Keep changes scoped and preserve unrelated user work.
4. After code or package changes in `universal-refiner`, run the strongest proportionate gate. For broad hardening, use:

```powershell
cd C:\PersonalRepo\portfolio\Promptimprover\universal-refiner
npm.cmd run release:verify
```

5. Restart the local background runtime after rebuilding:

```powershell
$repo = 'C:\PersonalRepo\portfolio\Promptimprover\universal-refiner'
$env:PROMPT_REFINER_BACKGROUND = 'true'
Start-Process -WindowStyle Hidden -FilePath node -ArgumentList (Join-Path $repo 'dist\src\index.js') -WorkingDirectory $repo
```

6. Smoke-test runtime health:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

## Release Gates

The authoritative local gate is:

```powershell
npm.cmd run release:verify
```

It includes build, 100% coverage, MCP acceptance, semantic fallback, tracked-turn acceptance, stress/recovery/soak, production and full audit checks, secret scanning, package dry-run, and packaged runtime startup smoke.

## Global Registration

Use the registration doctor after changes that affect global MCP wiring:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-global.ps1 -Check
```

Apply only when the check reports real drift:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-global.ps1 -Apply
```

The expected global MCP registrations are:

- Codex: `prompt-refiner`, `obsidian`
- Claude Code: `prompt-refiner`, `obsidian`, plus PromptImprover hooks
- Gemini: `prompt-refiner`, `obsidian`

## Security

- Never commit secrets, tokens, credentials, private prompts, or raw sensitive payloads.
- Treat `npm audit` failures as defects. Production audit is mandatory; full audit is also part of the release gate.
- If a plaintext token was ever present in local configuration, remove it and rotate it externally.
