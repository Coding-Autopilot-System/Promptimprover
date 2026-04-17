# AGENTS.md - Gemini Prompt Refiner Extension

Welcome to the **Gemini Prompt Refiner** extension project. This document serves as the authoritative guide for AI agents and developers working on this codebase.

## 1. Project Overview
- **Type**: Gemini CLI Extension / MCP Server
- **Language**: TypeScript (Node.js)
- **Primary Framework**: Model Context Protocol (MCP) SDK
- **Architecture**: Modular TypeScript/Node Project with specialized detectors, linters, and refiners.

This project implements an MCP server that provides tools for:
- Linting AI prompts for clarity and technical completeness.
- Generating clarifying questions to fill prompt gaps.
- Refining prompts based on SRP and SOLID principles.
- Proactive technical implementation planning using LLM sampling.
- Automated generation of agent onboarding documentation.

## 2. Architectural Mandates
This project follows the **Gemini CLI Extension Pattern**. Adhere to these structural rules:

- **Core Server (`src/core/`)**: The `PromptRefinerServer` manages MCP tool registration and request handling.
- **Detectors (`src/detectors/`)**: Use `project-scout.ts` to analyze the target workspace's language, framework, and patterns.
- **Logic Layers**:
  - `src/linters/`: Contains logic for analyzing prompt quality.
  - `src/refiners/`: Contains logic for rewriting and improving prompts.
- **Transport (`src/transport/`)**: Handles communication protocols (Standard I/O).

### Pattern Guidelines:
- **Separation of Concerns**: Keep detection logic separate from refinement logic.
- **Statelessness**: The MCP server should remain stateless where possible, relying on the project context gathered during each tool call.

## 3. Development Standards
- **TypeScript**: Use strict typing. Avoid `any` unless absolutely necessary (e.g., parsing unknown JSON).
- **SOLID & SRP**: Each class and function should have a single, well-defined responsibility.
- **Git**: Use descriptive commit messages. Follow standard branching strategies if applicable.
- **Error Handling**: Use `McpError` for tool-level errors to ensure compatibility with MCP clients.

## 4. Testing Guide
- **Current Status**: No automated test suite is currently configured in `package.json`.
- **Planned**: Integrate **Jest** or **Vitest** for unit testing the linters and refiners.
- **Manual Testing**: Test the MCP server using the `mcp-inspector` or by connecting it to a Gemini CLI session.

## 5. Security Rules
- **No Secret Leaking**: Never log or print environment variables, API keys, or sensitive user data.
- **Input Validation**: Use `zod` (already a dependency) to validate all tool arguments at the server entry point.
- **File System Safety**: When using detectors, only read metadata or configuration files (e.g., `package.json`, `tsconfig.json`). Avoid reading large binary files or sensitive user data.

## 6. How to Contribute
1. **Adding a Tool**: Register the tool in `src/core/server.ts` within `ListToolsRequestSchema` and implement the handler in `CallToolRequestSchema`.
2. **Improving Detection**: Update `src/detectors/project-scout.ts` to recognize new frameworks or patterns.
3. **Refinement Logic**: Modify `src/refiners/prompt-refiner.ts` to improve the quality of generated prompts.

---
*This file was generated to guide AI agents in maintaining and extending the Gemini Prompt Refiner.*
