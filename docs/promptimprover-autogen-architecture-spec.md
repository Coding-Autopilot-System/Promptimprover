# PromptImprover + Autogen Architecture Spec

Date: 2026-04-12

## Purpose

This document captures the target architecture for turning PromptImprover into:

- an always-on intake layer for prompts
- a routing and memory layer for agent work
- a learning layer backed by prompt history, execution history, tests, and git commits
- an enterprise-grade local portal with timeline, commit intelligence, and prompt library views

This is a design document for later implementation.

## Core Direction

PromptImprover should become the always-on intake, routing, evidence, and learning layer.

Autogen should remain the execution engine.

Git history should become the long-term proof of what actually changed and what should be learned from it.

## High-Level Flow

1. Prompt arrives at PromptImprover.
2. PromptImprover captures and stores the raw prompt.
3. PromptImprover classifies intent, complexity, scope, and risk.
4. PromptImprover gathers repo context, rules, active sessions, and recent history.
5. PromptImprover selects a workflow and dispatches to Autogen when appropriate.
6. Autogen executes and returns structured results.
7. Tests, commits, and outcomes are recorded.
8. PromptImprover derives lessons and prompt templates from the stored evidence.
9. A local portal shows the full history and provides copy-paste prompt templates.

## Always-On Intake Policy

Every supported prompt should pass through PromptImprover first.

Always means:

- always capture
- always classify
- always record
- always route

Always does not mean:

- always rewrite the prompt
- always ask questions
- always run a heavy workflow

## Intent Model

PromptImprover should classify prompts into one of these intent groups:

- `prompt_refinement`
- `implementation`
- `debugging`
- `architecture`
- `verification`
- `operational`
- `documentation`
- `maintenance`

Each prompt should also receive:

- `complexity`: `trivial`, `standard`, `substantial`, `high_risk`
- `scope`: `single_repo`, `multi_repo`, `global`
- `risk`: `low`, `medium`, `high`

Example classification:

```json
{
  "intent": "debugging",
  "complexity": "substantial",
  "scope": "single_repo",
  "risk": "medium",
  "repoPath": "C:\\repo\\autogen"
}
```

## Workflow Routing Rules

Use deterministic routing first.

Intent-to-workflow mapping:

- `prompt_refinement` -> local refinement workflow
- `implementation` -> `autogen_implementation`
- `debugging` -> `autogen_debug`
- `architecture` -> `autogen_plan`
- `verification` -> `autogen_verify`
- `operational` -> `local_ops` or `autogen_ops`
- `documentation` -> `local_docs` or `autogen_docs`
- `maintenance` -> `autogen_maintenance`

Complexity rules:

- `trivial` -> prefer local handling
- `standard` -> route by intent
- `substantial` -> route to Autogen workflow
- `high_risk` -> require stronger validation and verification

Tie-breaker order:

1. recent historical workflow success for similar tasks
2. repo or module-specific routing hints
3. LLM tie-breaker only when routing remains ambiguous

## PromptImprover to Autogen Dispatch Contract

PromptImprover should send structured tasks to Autogen rather than raw chat only.

Example payload:

```json
{
  "promptId": "prm_2026_0001",
  "repoPath": "C:\\repo\\autogen",
  "intent": "debugging",
  "complexity": "substantial",
  "workflow": "autogen_debug",
  "rawPrompt": "Investigate stale dashboard state after restart.",
  "normalizedPrompt": "Investigate stale dashboard state after restart, identify root cause, implement fix, and validate with tests.",
  "context": {
    "language": "TypeScript",
    "framework": "Hono",
    "testing": "Vitest",
    "patterns": [
      "Modular TypeScript/Node Project"
    ]
  },
  "rules": [
    "validate persistence across restart",
    "prefer deterministic fallbacks over optional sampling"
  ]
}
```

Expected structured execution result:

```json
{
  "executionId": "exe_2026_0001",
  "status": "completed",
  "summary": "Fixed stale project selection after restart and added regression tests.",
  "artifacts": {
    "filesChanged": [
      "src/core/dashboard.ts",
      "tests/memory.test.ts"
    ],
    "testsRun": [
      {
        "name": "vitest",
        "status": "passed"
      }
    ],
    "commits": [
      "abc1234"
    ]
  }
}
```

## Storage Recommendation

Use a hybrid storage model:

- SQLite for normalized metadata and queryable history
- filesystem artifacts for large prompt bodies, diffs, logs, and generated summaries

Suggested artifact root:

```text
.refiner-data/
  artifacts/
    prompts/
    diffs/
    summaries/
    logs/
```

## Core Tables

### `repos`

```sql
CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  agent_name TEXT,
  repo_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

### `prompts`

```sql
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  client TEXT NOT NULL,
  agent_name TEXT,
  raw_prompt TEXT NOT NULL,
  normalized_prompt TEXT,
  intent TEXT,
  complexity TEXT,
  scope TEXT,
  risk TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]'
);
```

### `routing_decisions`

```sql
CREATE TABLE routing_decisions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  selected_executor TEXT NOT NULL,
  selected_workflow TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  sampling_available INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

### `executions`

```sql
CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  executor_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  result_summary TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '{}'
);
```

### `tests`

```sql
CREATE TABLE tests (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

### `commits`

```sql
CREATE TABLE commits (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  author TEXT,
  message TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  branch TEXT,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  diff_stats_json TEXT NOT NULL DEFAULT '{}'
);
```

### `execution_commits`

```sql
CREATE TABLE execution_commits (
  execution_id TEXT NOT NULL,
  commit_id TEXT NOT NULL
);
```

### `events`

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  repo_id TEXT,
  session_id TEXT,
  prompt_id TEXT,
  execution_id TEXT,
  commit_id TEXT,
  timestamp TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
```

Recommended event types:

- `prompt_received`
- `prompt_classified`
- `prompt_refined`
- `project_context_resolved`
- `workflow_selected`
- `task_dispatched`
- `execution_started`
- `execution_progress`
- `execution_completed`
- `execution_failed`
- `test_run_started`
- `test_run_completed`
- `commit_detected`
- `commit_summarized`
- `rollback_detected`
- `lesson_proposed`
- `lesson_approved`
- `template_proposed`
- `template_approved`
- `runtime_warning`
- `runtime_error`

### `lessons`

```sql
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  prompt_id TEXT,
  execution_id TEXT,
  commit_id TEXT,
  lesson_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended lesson types:

- `prompt_quality`
- `workflow_choice`
- `testing_gap`
- `architecture_pattern`
- `operational_failure`
- `rework_pattern`
- `repo_convention`
- `verification_pattern`

### `prompt_clusters`

```sql
CREATE TABLE prompt_clusters (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  intent TEXT NOT NULL,
  category TEXT NOT NULL,
  cluster_title TEXT NOT NULL,
  cluster_summary TEXT NOT NULL,
  representative_prompt TEXT NOT NULL,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0,
  avg_rework_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `prompt_templates`

```sql
CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  cluster_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  template_text TEXT NOT NULL,
  usage_notes TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  success_score REAL NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `prompt_template_links`

```sql
CREATE TABLE prompt_template_links (
  template_id TEXT NOT NULL,
  prompt_id TEXT,
  execution_id TEXT,
  commit_id TEXT,
  lesson_id TEXT
);
```

## Prompt Library Goal

The Prompt Library should become an evidence-backed copy-paste library of prompts that actually produced good outcomes.

It should not be a simple saved-prompts page.

Every template should be traceable to:

- successful prompts
- linked executions
- linked commits
- linked lessons
- test outcomes

## Prompt Library Page Design

Top-level nav item:

- `Prompt Library`

Top bar:

- repo selector
- category filter
- approved-only toggle
- search
- sort by success score, usage, recency, or title

Primary sections:

### Recommended Templates

Show approved templates with:

- title
- category
- prompt preview
- usage notes
- success score
- usage count
- repo scope
- copy action
- evidence action

### Recent Successful Prompts

Show recently successful prompts with:

- prompt preview
- repo
- intent
- workflow
- result summary
- linked commit

### Templates By Intent

Grouped categories:

- Debugging
- Implementation
- Verification
- Architecture
- Operations
- Documentation
- Maintenance

### Needs Review

Show generated but unapproved templates with:

- title
- generated template
- source cluster
- confidence
- evidence count

Actions:

- approve
- edit
- reject

### Deprecated Templates

Keep templates that are outdated or correlated with poor outcomes out of the default library while preserving audit history.

## Enterprise UI Direction

The local portal should feel like an internal engineering operations product.

Use:

- neutral, professional palette
- strong typography hierarchy
- dense but readable layout
- clear status chips
- sortable/filterable tables
- searchable cards and lists
- evidence drill-down

Avoid:

- chat-style presentation
- consumer-app look
- excessive animation

## Commit Intelligence Page

Each commit should show:

- SHA
- branch
- author
- message
- changed files
- diff summary
- linked prompt
- linked execution
- test evidence
- summary of why the change was made
- summary of what was learned
- whether a later commit corrected or superseded it

## LLM Role

Use LLMs only on top of stored evidence.

Good uses:

- summarize commit intent
- infer lessons from repeated successes or failures
- synthesize prompt templates from successful prompt clusters
- generate best-known prompt suggestions

Bad uses:

- replacing deterministic routing
- inventing history without evidence
- auto-approving templates with no review

## Suggested MCP / API Contracts

High-value operations to add later:

- `record_prompt_event`
- `record_routing_decision`
- `record_execution_result`
- `record_test_result`
- `ingest_commit_history`
- `summarize_commit`
- `generate_prompt_templates`
- `list_prompt_templates`
- `approve_prompt_template`
- `get_template_evidence`

## Recommended Folder Structure

Add later under `universal-refiner/src/`:

```text
history/
  event-store.ts
  schema.ts
  prompt-events.ts
  execution-events.ts
  commit-ingest.ts
  lesson-engine.ts
  template-engine.ts
ui/
  history-api.ts
```

## Phased Roadmap

### Phase 1: Data Foundation

Build:

- SQLite event store
- schema migrations
- prompt, routing, execution, and test records
- commit ingestion

### Phase 2: Commit Intelligence

Build:

- normalized commit ingestion
- changed-file capture
- commit summaries
- execution-to-commit linking
- timeline endpoint
- commit detail endpoint

### Phase 3: Prompt Library Foundation

Build:

- lessons
- prompt clusters
- prompt templates
- template evidence links
- list and approve template flows

### Phase 4: LLM Learning Layer

Build:

- LLM-based lesson extraction
- LLM-based commit summary enhancement
- LLM-based prompt template synthesis

### Phase 5: Enterprise Portal

Build pages:

- Timeline
- Commit Intelligence
- Operations
- Learning
- Prompt Library

## Best First Deliverable

The strongest first implementation slice is:

- persistent event store
- prompt-to-execution chain
- commit ingestion
- timeline page
- commit intelligence page

Immediately after that:

- evidence-backed prompt library with copy-paste templates

## Key Principle

For every lesson, prompt template, or summary shown in the UI, it should always be possible to answer:

- which prompts produced this
- which executions support it
- which commits prove it
- which tests confirmed it

That traceability is what makes the system credible and enterprise-grade.
