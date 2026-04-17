# ROADMAP

## Milestone: Background Autonomy (Auto-Pilot)
**Goal**: Every file save or git commit must automatically trigger history ingestion, correlation, and lesson extraction without user intervention.

## Phases

- [ ] **Phase 1: Real-time File System Watcher** - Detect file changes and filter for relevance.
- [ ] **Phase 2: Continuous Learning Pipeline** - Automate the ingestion and extraction triggers.
- [ ] **Phase 3: Auto-Pilot Dashboard** - Visual status and activity log for background tasks.

## Phase Details

### Phase 1: Real-time File System Watcher
**Goal**: Implement a robust file system listener that identifies meaningful project changes.
**Depends on**: Nothing
**Requirements**: AUTO-01, AUTO-02
**Success Criteria**:
  1. System detects and logs file save events for source and prompt files.
  2. Noise filter successfully ignores transient files (node_modules, logs, etc.).
**Plans**: TBD

### Phase 2: Continuous Learning Pipeline
**Goal**: Connect observation triggers to the Learning Layer for "zero-touch" updates.
**Depends on**: Phase 1
**Requirements**: AUTO-03, AUTO-04
**Success Criteria**:
  1. Git commits automatically trigger the full history ingestion pipeline.
  2. File saves trigger incremental ingestion and lesson extraction.
  3. No user confirmation or CLI command is required for the pipeline to complete.
**Plans**: TBD

### Phase 3: Auto-Pilot Dashboard
**Goal**: Provide user visibility into the autonomous state of the system.
**Depends on**: Phase 2
**Requirements**: AUTO-05, AUTO-06
**Success Criteria**:
  1. Visual "Auto-Pilot" status (Active/Idle/Busy) is visible in the Dashboard.
  2. An activity feed shows the most recent autonomous learning events.
**Plans**: TBD

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Real-time File System Watcher | 0/0 | Not started | - |
| 2. Continuous Learning Pipeline | 0/0 | Not started | - |
| 3. Auto-Pilot Dashboard | 0/0 | Not started | - |
