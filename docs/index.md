# PromptImprover Developer Documentation

Welcome to the PromptImprover developer documentation. PromptImprover is a **Model Context Protocol (MCP)-first prompt governance layer** designed for engineering workflows. It acts as an intelligent intermediary between an AI client and execution tools, adding repository-aware context, applying prompt refinement rules, and recording evidence to improve future runs.

## Overview

PromptImprover demonstrates three key concepts:
1. **Prompt governance before code execution**: Ensuring prompts meet engineering standards before they are processed.
2. **MCP-based integration**: Utilizing a standardized protocol instead of editor-specific glue code.
3. **Evidence-backed refinement**: Using historical commits, tests, and repo context to continuously improve prompt quality.

## Core Capabilities

- **Robust Commit Tracking**: Dynamically fetches all commits since the last known SHA, ensuring a gapless historical record.
- **Agent Output Logging**: Correlates execution outcomes with the prompts that generated them for continuous learning.
- **Predictive Learning**: Derives autonomous engineering mandates and templates from historical actions.
- **RAG Snippets**: Uses FlexSearch-based retrieval over the local codebase to inject relevant examples.
- **Persistent Memory**: SQLite-backed storage for rules, patterns, and history.

## Project Structure

- `universal-refiner/`: The core MCP server, refinement engine, and history/learning layer.
- `gemini-extension/`: Gemini-specific integration and CLI extension.
- `docs/`: Architecture specifications and developer guides.

## Getting Started

To dive deeper into how PromptImprover works internally, check out the [Architecture Overview](./architecture.md).
