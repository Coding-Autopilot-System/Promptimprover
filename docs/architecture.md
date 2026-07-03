# PromptImprover Architecture

This document outlines the technical architecture and logic of PromptImprover.

## High-Level Design

PromptImprover sits between the AI CLI (e.g., Claude, Cursor, Gemini) and the execution environment. It intercepts prompts, augments them with local repository context, applies governance rules, and records the interaction for future learning.

```mermaid
flowchart TD
    %% Entities
    Client[AI Client\nClaude Code / Cursor / Gemini CLI]
    PI_Core{PromptImprover Core\nuniversal-refiner}
    Output[Augmented Prompt\nReady for LLM Execution]
    
    %% Internal Services
    subgraph Engine [Governance & Refinement Engine]
        ContextScout[Context Scout\nLanguage & Framework Detectors]
        RAG[RAG Snippets\nFlexSearch Retrieval]
        LocalBrain[(SQLite Memory\nRules & History)]
        AutoHeal[Background Auto-Heal\nService]
        LocalLLM[Local Semantic Model\ngemma3:12b / 1b]
    end

    %% Flow
    Client -->|Raw Prompt via stdio| PI_Core
    PI_Core --> ContextScout
    ContextScout --> RAG
    RAG --> LocalBrain
    LocalBrain --> LocalLLM
    LocalLLM --> PI_Core
    
    PI_Core --> Output
    
    %% Feedback Loop
    Output -.-o|Event Store / History| LocalBrain
    AutoHeal -.->|Predictive Learning & Mandates| LocalBrain
    
    %% Styling
    classDef primary fill:#4A90E2,stroke:#333,stroke-width:2px,color:#fff;
    classDef secondary fill:#F5A623,stroke:#333,stroke-width:2px,color:#fff;
    classDef database fill:#7ED321,stroke:#333,stroke-width:2px,color:#fff;
    
    class Client,Output primary;
    class PI_Core,ContextScout,RAG,AutoHeal,LocalLLM secondary;
    class LocalBrain database;
```

## Component Breakdown

### 1. Context Scout
At startup, detectors scan the current workspace to identify languages, frameworks, and architectural signals. This ensures the refinement process is strictly tailored to the current codebase.

### 2. RAG Snippets (FlexSearch)
Uses `FlexSearch` to retrieve relevant code snippets, past solutions, and templates from the local repository. This semantic retrieval injects highly relevant examples into the context window before execution.

### 3. LocalBrain (SQLite Memory)
The persistent storage layer. It manages:
- Reusable refinement rules.
- Learned patterns from past executions.
- Prompt history and event store logs.

### 4. Local Semantic Model
An optional OpenAI-compatible local model (e.g., `gemma3:12b`) that processes and refines the prompt based on the collected context before it is finalized. If unavailable, rule-based refinement is used.

### 5. Learning & Auto-Heal
Background services continuously correlate historical commits and agent outputs to derive new engineering mandates, creating a self-improving loop.
