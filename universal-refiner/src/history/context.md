# Context: History & Learning Layer

Location: `universal-refiner/src/history/`

## Purpose
This module is responsible for the "Compounding Memory" of the system. It records every prompt, execution, and commit to derive engineering lessons and autonomous prompt templates.

## Key Files
- **[event-store.ts](./event-store.ts)**: Singleton manager for the SQLite database. Handles all CRUD for events, prompts, and executions.
- **[schema.ts](./schema.ts)**: Contains the SQL schema definitions.
- **[commit-ingest.ts](./commit-ingest.ts)**: Worker for watching git history and ingesting commits.
- **[correlation-engine.ts](./correlation-engine.ts)**: Logic for linking prompts to specific code changes (commits).
- **[lesson-extractor.ts](./lesson-extractor.ts)**: LLM-driven engine for deriving reusable lessons from history.
- **[timeline.ts](./timeline.ts)**: API for retrieving chronological views of project activity.

## Module Instructions
1. **SQLite Integrity**: Always use parameterized queries via `better-sqlite3`.
2. **Event Correlation**: When recording an execution, ensure it is linked back to a `prompt_id`.
3. **Execution Feedback**: Use `updateExecution` to log agent outcomes and final summaries.
4. **Commit Ingestion**: The `CommitIngester` fetches commits dynamically from the `lastSha` found in the database.
5. **Commit Linking**: Commits should be linked to an `execution_id` only if the timestamp and author align with a recorded refinement task.
6. **Data Privacy**: Never store raw secrets or credentials in the event store.
