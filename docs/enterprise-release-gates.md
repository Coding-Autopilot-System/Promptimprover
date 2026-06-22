# Enterprise Release Gates

Passing unit tests alone does not prove that PromptImprover is operationally ready. A release is eligible only when every required gate below passes.

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
5. Local semantic-provider primary, fallback, malformed-response, timeout, and outage paths pass.
6. SQLite restart, migration, backup/restore, contention, and multi-process tests pass.
7. Claude and Gemini hook pre/post flows pass; Codex MCP-first flow passes.
8. Dashboard API security, review mutation, health telemetry, and browser smoke flows pass.
9. Dependency audit reports no known production or development vulnerabilities at high severity or above.
10. Package dry-run plus `acceptance:package-runtime` global installation, runtime startup, and health smoke tests pass.
11. Secret scanning finds no committed credentials.
12. Linux and Windows CI jobs pass before merge.

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

## Operator Recovery

Build before invoking the recovery commands. Both operations run SQLite integrity checks and fail closed:

```powershell
npm.cmd run db:backup -- C:\backups\promptimprover-events.db
npm.cmd run db:restore -- C:\backups\promptimprover-events.db
```

Stop the PromptImprover runtime before restoring a backup.

## Meaning Of Green

A green release pipeline means all declared gates passed in the tested environments. It substantially increases confidence but does not claim that unknown failures are impossible. Production incidents must become new automated regression gates.
