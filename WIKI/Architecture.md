# Architecture

Promptimprover intercepts and optimizes prompts via MCP.

## The Governance Pipeline

\\\mermaid
graph TD;
    Client[User IDE / CLI] -->|Raw Prompt| MCP[MCP Server]
    MCP --> Classifier[Intent Classifier]
    Classifier --> ContextDB[Repo Context Engine]
    ContextDB --> Refiner[Prompt Refiner]
    Refiner -->|Optimized Prompt| LLM[Frontier LLM]
    LLM --> Execution[Code Execution]
    Execution --> Watcher[Outcome Watcher]
    Watcher -.->|Feedback Loop| ContextDB
\\\

## Evidence-Backed Refinement
Instead of treating chat as disposable, the Outcome Watcher maps prompt strategies to actual pass/fail ratios from the CI pipeline, meaning the refiner gets sharper the more you use it.
