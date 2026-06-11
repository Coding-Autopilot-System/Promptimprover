# Portfolio Proof Notes

This repo is best read as an enterprise-oriented MCP and prompt-governance prototype, not as a generic prompt helper.

## Present-State Evidence

- `universal-refiner/package.json` defines the active package as `gemini-prompt-refiner` and describes it as cross-CLI prompt refinement using an MCP server.
- `universal-refiner/tests/` contains targeted Vitest coverage for detectors, history, lessons, memory, snippets, predictive refinement, timeline behavior, and server behavior.
- `build_and_install.ps1` installs the `universal-refiner` package globally as `prompt-refiner`, showing the intended operator entry point.

## Governance Signal

- The root `context.md` makes traceability and post-change verification explicit project mandates.
- `universal-refiner/AGENTS.md` requires MCP-first workflow for non-trivial repo work and treats prompt activity as durable operational history.
- The architecture spec defines prompts as governed artifacts that should be captured, classified, routed, and linked to outcomes.

## Roadmap Boundary

The strongest implemented proof is the MCP refinement server and its tests. Broader portal, dispatch, and evidence workflows are documented direction in [promptimprover-autogen-architecture-spec.md](./promptimprover-autogen-architecture-spec.md), not all fully realized product surface today.
