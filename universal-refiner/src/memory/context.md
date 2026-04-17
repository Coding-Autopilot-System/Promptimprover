# Context: Memory Layer (RAG & Patterns)

Location: `universal-refiner/src/memory/`

## Purpose
This module provides the "Long-term Memory" for the refiner. it uses RAG (Retrieval Augmented Generation) to inject project-specific code snippets and patterns into prompts.

## Key Files
- **[neural-snippets.ts](./neural-snippets.ts)**: Implements the RAG system. Searches the local codebase for relevant snippets.
- **[local-brain.ts](./local-brain.ts)**: Manages persistent project-level engineering mandates and learned patterns.

## Module Instructions
1. **Snippet Precision**: Prioritize high-signal files (main entry points, core logic) over boilerplate when retrieving snippets.
2. **Pattern Persistence**: All patterns learned via `discover_rules` must be saved to `local-brain.ts`.
3. **Consistency**: Ensure injected mandates match the current project's `GEMINI.md` where possible.
