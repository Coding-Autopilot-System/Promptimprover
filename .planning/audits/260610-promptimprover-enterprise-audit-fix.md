# GSD Audit-Fix: Promptimprover Enterprise Readiness

**Date:** 2026-06-10
**Source:** audit-uat fallback to direct repository evidence because `.planning/phases` contains no UAT or verification artifacts
**Invocation:** `$gsd-audit-fix --severity all --max 8`
**Scope:** enterprise readiness, npm packaging, command behavior, security, CI, tests, cross-platform installer, documentation

## Classification

| ID | Finding | Severity | Classification | Reason |
|---|---|---|---|---|
| F-01 | Full test suite fails correlation behavior | High | Auto-fixable | Reproduced in a specific test and implementation |
| F-02 | npm audit reports one high and five moderate vulnerable dependencies | High | Auto-fixable | Lockfile-only remediation available |
| F-03 | Published npm tarball includes local memory, planning, source, tests, and nested tarball | High | Auto-fixable | Package boundary is explicit in package metadata |
| F-04 | Build script uses Windows-only shell commands | High | Auto-fixable | Replace asset copy with portable Node script |
| F-05 | CI skips a failing test, uses nondeterministic install, and does not validate build/package | High | Auto-fixable | Workflow changes are bounded and testable |
| F-06 | Repository tracks dependencies, generated outputs, runtime memory, and packaged archives | High | Auto-fixable | Precise ignore rules and index cleanup |
| F-07 | Dashboard network bind is not explicitly restricted to loopback | High | Auto-fixable | Secure default with explicit override and test |
| F-08 | Installer is Windows-only and lacks fail-fast validation | Medium | Auto-fixable | Add deterministic Windows/POSIX installers and docs |

## Results

| ID | Status | Commit | Verification |
|---|---|---|---|
| F-01 | Fixed | ebc2fea | 40/40 tests |
| F-02 | Fixed | 1d49cbd | npm audit: 0 vulnerabilities |
| F-03 | Fixed | ff137cc | npm tarball reduced from 84 to 25 runtime-only entries |
| F-04 | Fixed | eaf0273 | build and tests pass on Windows; CI matrix covers Linux and Windows |
| F-05 | Fixed | c0d2c97 | local CI command chain passes |
| F-06 | Fixed | b990f7d | 13,566 generated/runtime/dependency files removed from Git tracking |
| F-07 | Fixed | 4df621c | 43/43 tests; loopback default regression coverage |
| F-08 | Fixed | f933bf9 | Windows installer end-to-end; POSIX shell syntax check |

## Manual-Only Follow-Up

- Decide whether to retire or independently maintain the duplicated `gemini-extension` and legacy `mcp-server` packages.
- Design a production remote HTTP MCP deployment with OAuth 2.1 or managed identity; the current supported runtime is intentionally local stdio plus a loopback dashboard.
- Add a release workflow with npm provenance, signed GitHub releases, SBOM generation, and a documented versioning policy.
- Replace `universal-refiner/register-global.ps1` hard-coded paths and direct configuration mutation with a reviewed, idempotent registration command.

## Final Verification Contract

- `npm ci --no-fund`
- `npm audit --omit=dev --audit-level=high`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `npm pack --dry-run`
- `powershell.exe -NoProfile -File .\build_and_install.ps1`
- `bash -n ./build_and_install.sh`
- `git diff --check`