# AGENTS.md - Universal Refiner Repo Policy

> **CRITICAL**: Before proceeding with any task, you MUST consult the **[context.md hierarchy](../context.md)**. Specifically, read the **[universal-refiner/context.md](./context.md)** and any relevant sub-module context files (e.g., `src/history/context.md`) to ensure you have the correct localized instructions.

This file is the repo-local operating policy for AI agents working in this repository. Apply these instructions only inside `universal-refiner`.

## 1. Purpose
- This repository contains an MCP server for prompt refinement, prompt linting, repo-aware guidance, and dashboard/state tracking.
- Agents working in this repo should prefer using this MCP as part of their normal workflow so prompt activity for this repo is visible in the local dashboard and blackboard state.
- This policy is repo-scoped. Do not assume the same MCP-first behavior applies outside this repository.

## 2. MCP-First Workflow
- For any non-trivial task in this repo, call `lint_prompt` before making code changes or architectural recommendations.
- If `lint_prompt` returns actionable gaps, use those gaps to guide clarifying questions or explicitly state assumptions before proceeding.
- Use `create_questions` when the prompt is ambiguous and the user intent is not yet concrete enough for safe implementation.
- Use `finalize_prompt` when the user is asking for a refined or better-structured version of their prompt.
- **Mandatory Output Logging**: After executing a task based on a refined prompt, you MUST call `record_agent_output` using the `PROMPT_ID` found in the header of the refined text. This ensures the outcome is visible in the project history.
- Use `proactive_suggest` for substantial design or planning work if the connected client supports MCP sampling.
- Use `discover_rules` only when repeated repo-level patterns or mandates should be promoted into reusable memory.
- Use `approve_rule` and `ingest_pattern` to maintain durable repo memory when a pattern is clearly worth preserving.

## 3. When MCP Use Is Mandatory
- Before implementing a feature with multiple files or architectural impact.
- Before changing prompt-refinement logic, detectors, dashboard state handling, or persistence behavior.
- Before making assumptions about framework, testing setup, or architectural patterns in this repo.
- Before proposing new repo-wide mandates or conventions.

## 4. When MCP Use Can Be Skipped
- Trivial edits that do not change behavior.
- Pure formatting changes.
- Narrow follow-up edits where the relevant repo context was already gathered moments earlier in the same session.
- Cases where the MCP is unavailable or the connected client does not support the required capability. In that case, continue locally and state that MCP support was unavailable.

## 5. Expectations For Agents
- Treat this MCP as the preferred repo-context source for this repository.
- Do not wait for the user to type a special command to use the MCP.
- Use MCP tools silently as part of normal execution when the client supports them.
- Keep MCP usage purposeful. Do not spam the dashboard with redundant tool calls.
- Prefer `lint_prompt` as the standard first touch rather than jumping directly to more expensive or optional tools.

## 6. Architectural Notes
- **Core Server (`src/core/`)**: `PromptRefinerServer` owns MCP tool registration, request handling, logging, and runtime behavior.
- **Detectors (`src/detectors/`)**: `project-scout.ts` is the repo-context entry point for language, framework, and pattern detection.
- **Memory (`src/memory/`, `src/core/blackboard.ts`)**: Repo memory, active intent tracking, logs, and persistent dashboard state must remain durable across restarts.
- **Dashboard (`src/core/dashboard.ts`)**: The dashboard is an operational view of MCP activity for this repo and should reflect real tool usage, not synthetic noise.

## 7. Engineering Standards
- Use strict TypeScript and keep logic modular.
- Keep detection, linting, refinement, persistence, and transport concerns separated.
- Use `McpError` for tool-level failures where protocol-compatible error handling is required.
- Do not silently swallow operational failures. Log or surface them meaningfully.
- Avoid adding features that depend entirely on optional MCP sampling without a graceful fallback.

## 8. Testing And Validation
- Validate persistence and restart behavior when changing blackboard, dashboard, or memory logic.
- Prefer automated tests for any change that affects repo memory, runtime logging, or dashboard-visible state.
- If MCP behavior depends on client capabilities, make the fallback behavior explicit and testable.

## 9. Security Rules
- Never log secrets, tokens, API keys, or private user content.
- Validate all MCP tool inputs at the server boundary.
- Keep repo inspection focused on relevant metadata and source files. Avoid unnecessary reads of unrelated or sensitive content.

## 10. Limits
- These instructions increase MCP usage only for agents that actually read and honor `AGENTS.md`.
- This file does not force external CLIs or apps to call the MCP if they are not designed to do so.
- If a client ignores repo-local instructions entirely, MCP usage must be increased in that client's own configuration or system prompt.
