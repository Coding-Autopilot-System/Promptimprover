# GEMINI.md - Engineering Mandates for Prompt Refiner

> **CRITICAL**: For localized project context and module-specific instructions, always refer to the **[context.md hierarchy](../context.md)**.

This file defines the engineering mandates and standards for the Gemini Prompt Refiner project. These rules are foundational and take precedence over general workflows.

## 1. Enhanced Project Detection & Contextual Awareness
- **ID**: `enhanced-detection`
- **Category**: `Architecture`
- **Description**: Extend `src/detectors/project-scout.ts` to identify a wider range of modern frameworks and tools (e.g., Tailwind CSS, Prisma, Drizzle, etc.). Ensure detection logic handles diverse project structures like monorepos. The goal is to provide highly accurate, context-aware prompt refinements.

## 2. Standardized MCP Tool Response Format
- **ID**: `standardized-responses`
- **Category**: `Architecture`
- **Description**: All MCP tools in `src/core/server.ts` MUST return a consistent, structured response. Responses should clearly separate the primary tool output from additional context or suggested actions. This ensures reliable interoperability with all MCP-compliant clients.

## 3. Comprehensive Automated Testing Strategy
- **ID**: `automated-testing`
- **Category**: `Quality Assurance`
- **Description**: Maintain a comprehensive automated test suite using **Vitest**. Prioritize unit tests for logic in `src/linters/` and `src/refiners/`, and integration tests for the MCP server handlers. All new features or bug fixes MUST include corresponding tests to ensure long-term stability and behavioral correctness.

## 4. Strict Type Safety & SOLID Principles
- **ID**: `type-safety-solid`
- **Category**: `Development Standards`
- **Description**: Adhere to strict TypeScript typing; avoid `any` unless absolutely necessary. Rigorously apply SOLID and SRP (Single Responsibility Principle) across the codebase. Each module, class, and function should have one clear responsibility, facilitating maintainability and extensibility.
