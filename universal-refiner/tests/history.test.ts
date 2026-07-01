import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";

describe("EventStore", () => {
  const testDir = path.join(os.tmpdir(), "refiner-test-" + Date.now());

  beforeEach(() => {
    process.env.PROMPT_REFINER_GLOBAL_DIR = testDir;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    const store = EventStore.getInstance();
    store.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Reset singleton for next test
    (EventStore as any).instance = null;
  });

  it("should initialize the database and schema", () => {
    const store = EventStore.getInstance();
    const dbPath = path.join(testDir, "events.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("should record an event", () => {
    const store = EventStore.getInstance();
    const event = {
      id: "evt_1",
      event_type: "test_event",
      summary: "Test event summary",
      details_json: JSON.stringify({ foo: "bar" })
    };

    store.recordEvent(event);

    // Verify by querying directly (using private db access for test)
    const db = (store as any).db;
    const row = db.prepare("SELECT * FROM events WHERE id = ?").get("evt_1");
    
    expect(row).toBeDefined();
    expect(row.event_type).toBe("test_event");
    expect(row.summary).toBe("Test event summary");
    expect(JSON.parse(row.details_json)).toEqual({ foo: "bar" });
  });

  it("should record a prompt and an associated event", () => {
    const store = EventStore.getInstance();
    const prompt = {
      id: "prm_1",
      client: "test_client",
      raw_prompt: "Hello world",
      intent: "testing"
    };

    store.recordPrompt(prompt);

    const db = (store as any).db;
    const pRow = db.prepare("SELECT * FROM prompts WHERE id = ?").get("prm_1");
    expect(pRow).toBeDefined();
    expect(pRow.raw_prompt).toBe("Hello world");
    expect(pRow.intent).toBe("testing");

    const eRow = db.prepare("SELECT * FROM events WHERE prompt_id = ?").get("prm_1");
    expect(eRow).toBeDefined();
    expect(eRow.event_type).toBe("prompt_received");
  });

  it("records a global lesson without a repository id", () => {
    const store = EventStore.getInstance();
    store.recordLesson({
      id: "global-lesson",
      lesson_type: "quality",
      title: "Global",
      summary: "Global lesson",
      confidence: "high",
      source: "test",
    });
    const db = (store as any).db;
    expect(db.prepare("SELECT repo_id FROM lessons WHERE id = ?").get("global-lesson")).toEqual({ repo_id: null });
  });

  it("uses the default global directory when no override is configured", () => {
    const previous = process.env.PROMPT_REFINER_GLOBAL_DIR;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    expect((EventStore as any).resolveDatabasePath()).toContain(".refiner");
    process.env.PROMPT_REFINER_GLOBAL_DIR = previous;
  });

  it("should expose only approved lessons to future refinements", () => {
    const store = EventStore.getInstance();
    store.recordLesson({
      id: "pending",
      repo_id: "repo",
      lesson_type: "quality",
      title: "Pending",
      summary: "Do not inject yet",
      confidence: "high",
      source: "test",
    });
    store.recordLesson({
      id: "approved",
      repo_id: "repo",
      lesson_type: "quality",
      title: "Approved",
      summary: "Inject this",
      confidence: "medium",
      source: "test",
      approved: 1,
    });

    expect(store.getRecentLessons("repo").map(lesson => lesson.id)).toEqual(["approved"]);
  });

  it("records one terminal outcome and gates its lesson candidate on approval", () => {
    const store = EventStore.getInstance();
    const outcome = {
      goal_id: "goal-1",
      repo_id: "repo",
      status: "completed" as const,
      evidence: ["cas://evidence/verification/1"],
      summary: "All mandatory checks passed.",
      candidate: {
        id: "lesson-goal-1",
        lesson_type: "quality",
        title: "Candidate lesson",
        summary: "Preserve deterministic verification.",
        confidence: "high",
      },
    };

    expect(store.recordTerminalOutcome(outcome)).toBe(true);
    expect(store.recordTerminalOutcome(outcome)).toBe(false);
    expect(store.getTerminalOutcome("goal-1").status).toBe("completed");
    expect(store.getLearningCandidates("repo").lessons.map(lesson => lesson.id)).toEqual(["lesson-goal-1"]);
    expect(store.getRecentLessons("repo")).toEqual([]);

    expect(store.reviewLesson("repo", "lesson-goal-1", true)).toBe(true);
    expect(store.getRecentLessons("repo").map(lesson => lesson.id)).toContain("lesson-goal-1");

    expect(store.recordTerminalOutcome({
      goal_id: "goal-without-repo",
      status: "completed",
      evidence: ["cas://evidence/global"],
      summary: "Global terminal outcome",
    })).toBe(true);
  });

  it("rejects terminal outcomes without required evidence", () => {
    const store = EventStore.getInstance();

    expect(() => store.recordTerminalOutcome({
      goal_id: "goal-without-evidence",
      status: "failed",
      evidence: [],
      summary: "Missing evidence",
    })).toThrow("Terminal outcomes require goal id, summary, and evidence.");
  });

  it("should persist learning candidate approval and rejection", () => {
    const store = EventStore.getInstance();
    store.recordLesson({
      id: "lesson",
      repo_id: "repo",
      lesson_type: "quality",
      title: "Candidate",
      summary: "Candidate summary",
      confidence: "high",
      source: "test",
    });
    store.recordTemplate({
      id: "template",
      repo_id: "repo",
      category: "feature",
      title: "Candidate template",
      template_text: "Build [THING]",
      usage_notes: "test",
      source_type: "test",
      success_score: 80,
    });

    expect(store.getLearningCandidates("repo").lessons).toHaveLength(1);
    expect(store.reviewLesson("other-repo", "lesson", true)).toBe(false);
    expect(store.reviewLesson("repo", "lesson", true)).toBe(true);
    expect(store.reviewTemplate("other-repo", "template", false)).toBe(false);
    expect(store.reviewTemplate("repo", "template", false)).toBe(true);
    expect(store.getLearningCandidates("repo")).toEqual({ lessons: [], templates: [] });
    expect(store.getRecentLessons("repo").map(lesson => lesson.id)).toContain("lesson");
  });

  it("should idempotently record an already ingested commit", () => {
    const store = EventStore.getInstance();
    const commit = {
      id: "commit-1",
      repo_id: "repo",
      sha: "abc123",
      author: "Acceptance",
      message: "feat: acceptance",
      committed_at: "2026-06-14T10:00:00Z",
    };

    store.recordCommit(commit);
    expect(() => store.recordCommit(commit)).not.toThrow();

    const db = (store as any).db;
    expect(db.prepare("SELECT COUNT(*) AS count FROM commits WHERE id = ?").get(commit.id).count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM events WHERE commit_id = ?").get(commit.id).count).toBe(1);
  });

  it("should migrate legacy basename repository records to canonical identity", () => {
    const store = EventStore.getInstance();
    store.recordPrompt({ id: "legacy-prompt", repo_id: "service", client: "test", raw_prompt: "legacy" });

    const identity = store.ensureRepository("C:/repo/team/service");
    const db = (store as any).db;
    expect(identity.id).not.toBe("service");
    expect(db.prepare("SELECT repo_id FROM prompts WHERE id = ?").get("legacy-prompt").repo_id).toBe(identity.id);
  });

  it("returns only approved active templates for a repository", () => {
    const store = EventStore.getInstance();
    const identity = store.ensureRepository("C:/repo/team/service");
    for (const id of ["approved", "pending"]) {
      store.recordTemplate({
        id,
        repo_id: identity.id,
        category: "bugfix",
        title: id,
        template_text: `${id} template`,
        usage_notes: "",
        source_type: "test",
        success_score: id === "approved" ? 90 : 95,
      });
    }
    expect(store.reviewTemplate(identity.id, "approved", true)).toBe(true);

    expect(store.getTemplates(identity.id)).toMatchObject([
      { id: "approved", repoId: identity.id, approved: 1, deprecated: 0 },
    ]);
  });

  it("records complete optional metadata and all execution updates", () => {
    const store = EventStore.getInstance();
    store.recordEvent({
      id: "complete-event",
      event_type: "complete",
      repo_id: "repo",
      session_id: "session",
      prompt_id: "prompt",
      execution_id: "execution",
      commit_id: "commit",
      timestamp: "2026-06-15T00:00:00Z",
      severity: "warning",
      summary: "complete",
      details_json: JSON.stringify({ complete: true }),
    });
    store.recordPrompt({
      id: "complete-prompt",
      repo_id: "repo",
      session_id: "session",
      timestamp: "2026-06-15T00:00:00Z",
      client: "test",
      agent_name: "agent",
      raw_prompt: "complete",
      normalized_prompt: "normalized",
      intent: "test",
      complexity: "high",
      scope: "module",
      risk: "low",
      tags_json: "[\"complete\"]",
    });
    store.recordExecution({
      id: "complete-execution",
      prompt_id: "complete-prompt",
      workflow_name: "test",
      executor_name: "test",
      status: "started",
      started_at: "2026-06-15T00:00:00Z",
      ended_at: "2026-06-15T00:01:00Z",
      result_summary: "initial",
      artifacts_json: "{\"initial\":true}",
    });

    store.updateExecution({ id: "complete-execution" });
    store.updateExecution({
      id: "complete-execution",
      status: "completed",
      ended_at: "2026-06-15T00:02:00Z",
      result_summary: "done",
      artifacts_json: "{\"done\":true}",
    });

    const db = (store as any).db;
    expect(store.getExecutionByPromptId("missing")).toBeNull();
    expect(db.prepare("SELECT * FROM executions WHERE id = ?").get("complete-execution")).toMatchObject({
      status: "completed",
      ended_at: "2026-06-15T00:02:00Z",
      result_summary: "done",
      artifacts_json: "{\"done\":true}",
    });
  });

  it("records clusters and returns an existing canonical repository", () => {
    const store = EventStore.getInstance();
    store.recordCluster({
      id: "cluster",
      repo_id: "repo",
      intent: "test",
      category: "quality",
      cluster_title: "Quality",
      cluster_summary: "Quality cluster",
      representative_prompt: "Test it",
      prompt_count: 2,
      success_rate: 100,
    });

    const first = store.ensureRepository("C:/repo/existing");
    const second = store.ensureRepository("C:/repo/existing");
    expect(second).toEqual(first);
    expect((store as any).db.prepare("SELECT * FROM prompt_clusters WHERE id = ?").get("cluster")).toMatchObject({
      prompt_count: 2,
      success_rate: 100,
    });
  });

  it("records and lists prompt tournament evaluations for a repository", () => {
    const store = EventStore.getInstance();
    store.recordTournament({
      id: "tournament-1",
      repo_id: "repo",
      baseline_prompt: "Fix the failing tests",
      variant_a: "Fix the failing tests with regression coverage",
      variant_b: "Fix tests",
      winner_observed: "A",
      details_json: "{\"winner\":\"A\"}",
    });
    store.recordTournament({
      id: "tournament-2",
      repo_id: null,
      baseline_prompt: "Global baseline",
      variant_a: "Global A",
      variant_b: "Global B",
      winner_observed: "tie",
      details_json: "{}",
    });

    expect(store.getTournaments("repo", 10)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "tournament-1",
        repo_id: "repo",
        baseline_prompt: "Fix the failing tests",
        winner_observed: "A",
      }),
      expect.objectContaining({
        id: "tournament-2",
        repo_id: null,
        winner_observed: "tie",
      }),
    ]));
    expect(store.getTournaments("repo", 1)).toHaveLength(1);
  });

  it("backs up and restores a verified database", async () => {
    const store = EventStore.getInstance();
    store.recordEvent({ id: "before-backup", event_type: "test", summary: "persist me" });
    const backupPath = path.join(testDir, "backups", "events.db");

    await expect(store.backup(backupPath)).resolves.toBe(backupPath);
    store.recordEvent({ id: "after-backup", event_type: "test", summary: "remove me" });
    const restored = EventStore.restore(backupPath);
    const db = (restored as any).db;

    expect(db.prepare("SELECT id FROM events WHERE id = ?").get("before-backup")).toBeDefined();
    expect(db.prepare("SELECT id FROM events WHERE id = ?").get("after-backup")).toBeUndefined();
  });

  it("rejects missing and integrity-failing backups", async () => {
    const store = EventStore.getInstance();
    await expect(() => EventStore.restore(path.join(testDir, "missing.db"))).toThrow("Backup does not exist");

    const originalPragma = Database.prototype.pragma;
    const pragmaSpy = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, source: string, options?: any) {
      if (source === "integrity_check") {
        return "corrupt" as any;
      }
      return originalPragma.call(this, source, options);
    });

    const backupPath = path.join(testDir, "bad-backup.db");
    await expect(store.backup(backupPath)).rejects.toThrow("Backup integrity check failed");
    pragmaSpy.mockRestore();

    await store.backup(backupPath);
    const restorePragmaSpy = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, source: string, options?: any) {
      if (source === "integrity_check") {
        return "corrupt" as any;
      }
      return originalPragma.call(this, source, options);
    });
    expect(() => EventStore.restore(backupPath)).toThrow("Backup integrity check failed");
    restorePragmaSpy.mockRestore();
  });

  it("continues when WAL mode is unavailable", () => {
    const originalPragma = Database.prototype.pragma;
    const pragmaSpy = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, source: string, options?: any) {
      if (source === "journal_mode = WAL") {
        throw new Error("WAL unavailable");
      }
      return originalPragma.call(this, source, options);
    });
    expect(EventStore.getInstance()).toBeDefined();
    EventStore.getInstance().close();
    pragmaSpy.mockRestore();
  });

  it("logs and rethrows schema initialization errors", () => {
    const execSpy = vi.spyOn(Database.prototype, "exec").mockImplementationOnce(function (this: Database.Database) {
      throw new Error("schema failure");
    });

    expect(() => EventStore.getInstance()).toThrow("schema failure");
    execSpy.mockRestore();
    expect(() => fs.rmSync(testDir, { recursive: true, force: true })).not.toThrow();
  });

  it("supports rejection decisions and closing a non-singleton store", () => {
    const store = EventStore.getInstance();
    store.recordLesson({
      id: "reject-lesson",
      repo_id: "repo",
      lesson_type: "quality",
      title: "Reject",
      summary: "Reject",
      confidence: "low",
      source: "test",
    });
    store.recordTemplate({
      id: "approve-template",
      repo_id: "repo",
      category: "test",
      title: "Approve",
      template_text: "Approve",
      usage_notes: "",
      source_type: "test",
      success_score: 1,
    });

    expect(store.reviewLesson("repo", "reject-lesson", false)).toBe(true);
    expect(store.reviewTemplate("repo", "approve-template", true)).toBe(true);
    (EventStore as any).instance = null;
    expect(() => store.close()).not.toThrow();
  });
});
