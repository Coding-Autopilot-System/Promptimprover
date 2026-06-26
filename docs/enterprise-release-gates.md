# Enterprise Release Gates

Passing unit tests alone does not prove that PromptImprover is operationally ready. A release is eligible only when every required gate below passes.

For exact operator commands, current evidence, and the gate-to-CI mapping, see [Operator Testing Guide](./operator-testing.md).

## Quality Target

- All owned deterministic production logic reaches 100% statements, branches, functions, and lines.
- Coverage exclusions are limited to generated artifacts. Bootstrap and integration behavior must be validated through acceptance or end-to-end tests.
- The coverage threshold is ratcheted upward as gaps close. It must never decrease without an approved, documented exception.
- Every reproduced defect receives a regression test at the owning boundary.

## Required Gates

1. `npm ci` succeeds from a clean workspace.
2. TypeScript build succeeds with strict type checking.
3. Unit and integration tests pass with the enforced coverage threshold.
4. Every advertised MCP tool schema and dispatcher path passes acceptance tests.
5. The built MCP stdio server starts as a real child process, lists tools, and handles `lint_prompt`.
6. Local semantic-provider primary, fallback, malformed-response, timeout, and outage paths pass.
7. SQLite restart, migration, backup/restore, contention, and multi-process tests pass.
8. Claude and Gemini hook pre/post flows pass; Codex MCP-first flow passes.
9. Dashboard API security, review mutation, health telemetry, and Chromium browser smoke flows pass.
10. Dependency audit reports no known production or development vulnerabilities at high severity or above.
11. Package dry-run plus `acceptance:package-runtime` global installation, runtime startup, and health smoke tests pass.
12. Secret scanning finds no committed credentials.
13. Linux, Windows, and dashboard E2E CI jobs pass before merge.

## Port Policy

- The operator dashboard/runtime port is fixed at `3000` and should be referenced as `http://127.0.0.1:3000`.
- The dashboard browser E2E gate uses fixed test port `3999` by default to avoid colliding with an already-running operator dashboard.
- Package-runtime acceptance may print a random ephemeral health-check port. That port is a test isolation detail, not a configuration value.

## Current Coverage Baseline

The first measured baseline on June 14, 2026 exposed substantial untested production behavior:

| Metric | Baseline | Target |
|---|---:|---:|
| Statements | 66.33% | 100% |
| Branches | 61.95% | 100% |
| Functions | 79.92% | 100% |
| Lines | 68.09% | 100% |

Initial high-risk gaps include MCP dispatcher behavior, background autonomy, template generation, prompt optimization, configuration failure paths, and operational dashboard branches.

The enforced ratchet is 100% statements, branches, functions, and lines. It cannot be lowered without an approved exception.

## Current Verified Release Baseline

The current release gate baseline is documented in [Operator Testing Guide](./operator-testing.md#current-verified-baseline). At the time this page was updated, `master` commit `abbff59cc6d62b734912e2a98c61ae3dc1d4c6b8` had a successful GitHub CI run (`28030976193`) and a local `npm.cmd run release:verify` pass with 51 test files, 382 tests, and 100% statements, branches, functions, and lines.

## Operator Recovery

Build before invoking the recovery commands. Both operations run SQLite integrity checks and fail closed:

```powershell
npm.cmd run db:backup -- C:\backups\promptimprover-events.db
npm.cmd run db:restore -- C:\backups\promptimprover-events.db
```

Stop the PromptImprover runtime before restoring a backup.

## Meaning Of Green

A green release pipeline means all declared gates passed in the tested environments. It substantially increases confidence but does not claim that unknown failures are impossible. Production incidents must become new automated regression gates.
