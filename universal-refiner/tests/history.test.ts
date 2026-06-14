import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
});
