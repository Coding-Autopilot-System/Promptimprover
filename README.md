# ?? Promptimprover: MCP-First Prompt Governance

![Visual Diagram](docs/assets/concept.png)


![Build Status](https://github.com/Coding-Autopilot-System/Promptimprover/actions/workflows/ci.yml/badge.svg)
![CodeQL](https://github.com/Coding-Autopilot-System/Promptimprover/actions/workflows/codeql.yml/badge.svg)
![Node 22](https://img.shields.io/badge/node-22-brightgreen)
![Version](https://img.shields.io/badge/version-3.0.0--elite-blue)

**Promptimprover** is an elite Model Context Protocol (MCP) server that acts as an intelligent prompt governance layer. It intercepts, classifies, and refines raw engineering prompts using deep repository context before they ever reach an LLM, ensuring maximum execution success.

## ?? Elite Features
* **Universal Refiner MCP**: Runs cross-CLI and editor-agnostic via the official MCP specification.
* **Intelligent Governance**: Evaluates raw prompts against past failures and auto-injects missing context.
* **Zero-Knowledge Evidence Engine**: Tracks execution outcomes and uses RLAIF (Reinforcement Learning from AI Feedback) to refine prompts dynamically.

## ? Quickstart
1. Ensure Node 22 is installed.
2. Build the MCP Server:
   \\\ash
   npm install && npm run build
   \\\
3. Link to your MCP client:
   \\\ash
   npm run link-mcp
   \\\

---
*For a deep dive into the internal graph architecture, please see the [Wiki](WIKI/Home.md).*
