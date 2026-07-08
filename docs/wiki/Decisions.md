# Decisions

## ADR convention

`docs/adr/README.md` establishes the convention (sequential numbering, Context/Decision/
Consequences) but **no numbered ADR files exist in the repo yet**. Decisions to date live in
`.planning/phases/` and the `docs/` architecture specs instead.

## Phase history (`.planning/phases/`, this repo's own GSD project)

| Phase | Topic |
|---|---|
| 01 | FS watcher |

See [`docs/promptimprover-autogen-architecture-spec.md`](../promptimprover-autogen-architecture-spec.md),
[`docs/enterprise-release-gates.md`](../enterprise-release-gates.md), and
[`docs/operator-testing.md`](../operator-testing.md) for the broader design record beyond the
single formal phase.

## Open decisions tracked in this Phase 36 refresh

- **PR #27** (`fix/dashboard-loopback-xss`) — bind dashboard to loopback and escape HTML in
  trace rendering; open, not yet merged.
- **PR #28** (`ci/sha-pin-and-least-privilege`) — pins third-party GitHub Actions to commit
  SHAs and least-privilege permissions; open, not yet merged.

<!-- docs-verified: 101f63d702e5c0ab8052c8e0c67a104d8edfbddb 2026-07-08 -->
