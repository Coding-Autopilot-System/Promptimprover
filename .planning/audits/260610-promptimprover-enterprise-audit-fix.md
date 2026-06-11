# GSD Audit-Fix: Promptimprover Enterprise Readiness

**Date:** 2026-06-10
**Invocation:** `$gsd-audit-fix --severity all --max 8`
**Source:** Direct repository evidence fallback; no `.planning/phases` UAT artifacts exist.

## Classification and Results

| ID | Finding | Severity | Classification | Result |
|---|---|---|---|---|
| F-01 | Correlation behavior fails the full test suite | High | Auto-fixable | Fixed in `726200b` |
| F-02 | npm audit reports vulnerable transitive dependencies | High | Auto-fixable | Fixed in `c4dc532` |
| F-03 | npm tarball leaks local state, planning, source, tests, and nested archive | High | Auto-fixable | Fixed in `a216215` |
| F-04 | Build uses Windows-only shell commands | High | Auto-fixable | Fixed in `6420017` |
| F-05 | CI skips a test and does not validate build/package or Windows | High | Auto-fixable, push-blocked | Fixed locally in `audit/promptimprover-full-enterprise-local`; GitHub rejected workflow push because OAuth lacks `workflow` scope |
| F-06 | Git tracks dependencies, generated outputs, runtime memory, and archives | High | Auto-fixable | Fixed in `69561f8` |
| F-07 | Dashboard network binding is not explicitly loopback-only | High | Auto-fixable | Fixed in `9806a26` |
| F-08 | Installer is Windows-only and lacks fail-fast validation | Medium | Auto-fixable | Fixed in `77c8de3` |

## Verification

- `npm ci --no-fund`: passed
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities
- `npx tsc --noEmit`: passed
- `npm test`: 15 files, 43 tests passed
- `npm run build`: passed
- `npm pack --dry-run`: 25 runtime-only entries
- Windows installer: passed end-to-end
- POSIX installer: shell syntax passed
- Installed command: dashboard HTTP 200 on `127.0.0.1`
- Git hygiene: 13,566 generated/runtime/dependency files removed from tracking

## Manual-Only Follow-Up

- Push the prepared CI workflow commit using a GitHub token with `workflow` scope.
- Decide whether to retire or independently maintain duplicated `gemini-extension` and legacy `mcp-server` packages.
- Design production remote HTTP MCP deployment with OAuth 2.1 or managed identity; current runtime is local stdio plus loopback dashboard.
- Add release provenance, signed GitHub releases, SBOM generation, and a versioning policy.
- Replace `universal-refiner/register-global.ps1` hard-coded paths and direct configuration mutation with an idempotent registration command.