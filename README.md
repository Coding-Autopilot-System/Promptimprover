# PromptImprover

[![CI](https://github.com/Coding-Autopilot-System/Promptimprover/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Coding-Autopilot-System/Promptimprover/actions/workflows/ci.yml)
[![Node 22](https://img.shields.io/badge/node-22-brightgreen)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Part of the [Coding-Autopilot-System](https://github.com/Coding-Autopilot-System) ecosystem:
[gsd-orchestrator](https://github.com/Coding-Autopilot-System/gsd-orchestrator) | [autogen](https://github.com/Coding-Autopilot-System/autogen)

PromptImprover is an MCP-first prompt governance layer for engineering workflows. It sits between an AI client and execution tools, adds repo-aware context, applies prompt refinement rules, and records evidence that can be used to improve future runs.

This repository is strongest as a portfolio demonstration of three ideas:

- prompt governance before code execution
- MCP-based integration instead of editor-specific glue
- evidence-backed refinement using history, tests, and repo context

## What It Demonstrates

- **MCP integration**: the active implementation is the `universal-refiner` package, a TypeScript MCP server for cross-CLI prompt refinement
- **Governance pipeline**: prompts can be captured, classified, refined, and linked to execution outcomes instead of being treated as disposable chat
- **Repo-aware context**: detectors, memory, and retrieval components adapt refinement to the current codebase
- **Proof-oriented design**: tests and architecture docs emphasize traceability, learning, and operational visibility rather than prompt rewriting alone

## Features

- **RAG snippets**: FlexSearch-based retrieval over the local codebase to inject relevant examples into prompt refinement
- **Persistent memory**: SQLite-backed storage for reusable rules, learned patterns, and prompt history
- **Context scouting**: detectors identify language, framework, and architectural signals at startup
- **Operational traceability**: history, timelines, and prompt-to-outcome correlation are first-class design goals

## Current Scope vs. Roadmap

The repo contains both implemented components and forward-looking architecture.

- **Implemented now**: the `universal-refiner` MCP server, Gemini-oriented packaging, tests, and install/build scripts
- **Designed for later expansion**: broader routing, portal, and evidence workflows described in the architecture spec

That distinction matters because this repo is about credible system direction, not vague AI middleware claims.

## Architecture Snapshot

```mermaid
flowchart LR
    CLI["AI CLI\n(Claude / Cursor)"] -->|"stdio"| PI["PromptImprover\n(prompt-refiner)"]
    subgraph internal["PromptImprover Engine"]
        RAG["RAG Snippets\n(FlexSearch)"]
        Memory["SQLite Memory\n(LocalBrain)"]
        AutoHeal["Auto-Heal\n(BackgroundService)"]
    end
    PI --> RAG
    PI --> Memory
    PI --> AutoHeal
    internal --> Out["Augmented Prompt"]
```

## Proof Points

- [Portfolio proof notes](./docs/portfolio-proof.md)
- [Architecture spec](./docs/promptimprover-autogen-architecture-spec.md)
- [`universal-refiner/package.json`](./universal-refiner/package.json)
- [`universal-refiner/tests`](./universal-refiner/tests)

## Quickstart

```powershell
git clone https://github.com/Coding-Autopilot-System/Promptimprover.git
cd Promptimprover
.\build_and_install.ps1
```

Add `prompt-refiner` to your MCP client configuration. See the [Setup Guide](https://github.com/Coding-Autopilot-System/Promptimprover/wiki/Setup-Guide) for full configuration instructions.

## License

MIT - see [LICENSE](LICENSE)
