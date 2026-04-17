# Universal Refiner Context

This directory contains the core intelligence and governance layer of PromptImprover.

## Sub-Module Contexts

Refer to these files for detailed instructions on each component:

- **[Core](./src/core/context.md)**: Server orchestration, configuration, and the Command Center Dashboard.
- **[History](./src/history/context.md)**: Event Store, Commit Ingestion, and the Learning Layer.
- **[Memory](./src/memory/context.md)**: Neural Snippets (RAG) and the Local Brain (persistent patterns).
- **[Engine](./src/refiners/context.md)**: Prompt Refinement and Linter logic.
- **[Detectors](./src/detectors/context.md)**: Tech stack and architectural pattern scouting.
- [Transport](./src/transport/context.md): MCP communication protocols.

## Component Ownership


- **MCP Server**: [src/core/server.ts](./src/core/server.ts)
- **Database Schema**: [src/history/schema.ts](./src/history/schema.ts)
- **Neural Storage**: [src/memory/neural-snippets.ts](./src/memory/neural-snippets.ts)

## Standards

All code in this directory must adhere to:
- **[GEMINI.md](./GEMINI.md)**: Project-specific engineering mandates.
- **[AGENTS.md](./AGENTS.md)**: Role-specific agent instructions.
- **Vitest**: All logic must be covered by tests in the `tests/` directory.
