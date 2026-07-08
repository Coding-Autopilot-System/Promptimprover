# PromptImprover Wiki

## Role in the CAS portfolio

`Promptimprover` is part of the **Governance plane** of the Coding-Autopilot-System
three-plane model (Control / Execution / Governance). It is an MCP-first prompt governance
layer: it sits between an AI CLI and execution tools, adds repo-aware context, applies
refinement rules, and — via its `AgenticBlackboard` — coordinates intent and history across
concurrent agent sessions rather than treating each prompt as disposable chat.

| Plane | This repo's responsibility |
|---|---|
| Control | *(not this repo — see `gsd-orchestrator`)* |
| Execution | *(not this repo — see `autogen`)* |
| Governance | Prompt refinement, cross-agent blackboard coordination, learning-review workflow |

## Quickstart

- [README.md](../../README.md) — Quickstart, Local Semantic Model, Proof Points
- [Architecture](./Architecture.md) — governance/blackboard flow
- [Operations](./Operations.md) — verified install/build/test/release-gate commands
- [Decisions](./Decisions.md) — phase history and ADR convention

## Ecosystem links

Part of the [Coding-Autopilot-System](https://github.com/Coding-Autopilot-System) org:
[gsd-orchestrator](https://github.com/Coding-Autopilot-System/gsd-orchestrator) (control plane) ·
[autogen](https://github.com/Coding-Autopilot-System/autogen) (execution plane) ·
[cas-contracts](https://github.com/Coding-Autopilot-System/cas-contracts) (shared schemas) ·
[cas-evals](https://github.com/Coding-Autopilot-System/cas-evals) (evidence gate)

<!-- docs-verified: 101f63d702e5c0ab8052c8e0c67a104d8edfbddb 2026-07-08 -->
