# Project Context: PromptImprover

This is the root context file for the PromptImprover project. It serves as the entry point for all agent instructions and project-wide standards.

## System Capabilities (v10.0)

- **Robust Commit Tracking**: The system dynamically fetches all commits since the last known SHA, ensuring a gapless historical record.
- **Agent Output Logging**: Agents can report execution results back via the `record_agent_output` tool using the `PROMPT_ID` injected into refined prompts.
- **Predictive Learning**: Historical commits and prompts are correlated to derive autonomous engineering mandates and templates.

## Project Hierarchy

All agents and tools MUST refer to the specific `context.md` files within each directory for localized instructions.

- **[Universal Refiner](./universal-refiner/context.md)**: The core MCP server, refinement engine, and history/learning layer.
- **[Gemini Extension](./gemini-extension/context.md)**: The Gemini-specific integration and CLI extension.
- **[MCP Server](./mcp-server/context.md)**: (Legacy/Standalone) MCP server implementation.
- **[Docs](./docs/context.md)**: Architecture specifications, roadmaps, and high-level design documents.
- **[Archive](./archive/context.md)**: Deprecated code and historical experiments.

## Global Mandates

1. **Hierarchy First**: Always read the local `context.md` before performing any task in a directory.
2. **Standardized Instructions**: Refer to `GEMINI.md` and `AGENTS.md` in each module for role-specific guidance.
3. **Traceability**: Every change must be linked to the `history/` layer (Event Store) where applicable.
4. **Post-Change Workflow**: After making any code changes, the agent MUST:
    - **Kill Existing Processes**: Identify and terminate any running instances or background processes related to the tool being modified.
    - **Restart & Verify**: Rebuild (if necessary) and restart the tool to ensure changes are active.
    - **Smoke Test**: Run a basic verification (test suite or manual invocation) to confirm the tool is live and functional.

## Unified Agent Entry Points

- Project-wide rules: [universal-refiner/GEMINI.md](./universal-refiner/GEMINI.md)
- Agent role definitions: [universal-refiner/AGENTS.md](./universal-refiner/AGENTS.md)
