# Context: Core Orchestration

Location: `universal-refiner/src/core/`

## Purpose
The core module handles the MCP server lifecycle, tool registration, configuration management, and the visual dashboard.

## Key Files
- **[server.ts](./server.ts)**: The entry point for the MCP server. Registers all tools and dispatches to specialists.
- **[config.ts](./config.ts)**: Manages global and project-specific settings.
- **[dashboard.ts](./dashboard.ts)**: Backend for the local Command Center UI.
- **[blackboard.ts](./blackboard.ts)**: Shared state for active agent intents.
- **[logger.ts](./logger.ts)**: Runtime logging system.

## Module Instructions
1. **Tool Registration**: All new tools must be registered in the `setupToolHandlers` method of `PromptRefinerServer`.
2. **Output Logging**: Agents MUST use `record_agent_output` to close the loop on refined prompts using the injected `PROMPT_ID`.
3. **Sampling Logic**: Always check for `samplingUnavailableReason` before attempting LLM sampling.
3. **Error Handling**: Use `McpError` for server-side failures to ensure compatible client responses.
4. **Dashboard Updates**: Important events should be pushed to `CommandCenterDashboard.log()` for real-time visibility.
