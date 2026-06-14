import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LessonExtractor } from "../src/history/lesson-extractor.js";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("LessonExtractor", () => {
  const testDir = path.join(os.tmpdir(), "refiner-lesson-test-" + Date.now());

  beforeEach(() => {
    process.env.PROMPT_REFINER_GLOBAL_DIR = testDir;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    (EventStore as any).instance = null;
  });

  afterEach(() => {
    const store = EventStore.getInstance();
    store.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should analyze a linked pair and extract a lesson", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    
    // Setup linked pair
    store.recordPrompt({ id: "p1", repo_id: "test", client: "cli", raw_prompt: "Create login" });
    db.prepare("INSERT INTO commits (id, repo_id, sha, message, committed_at) VALUES (?, ?, ?, ?, ?)").run("c1", "test", "sha1", "feat: add login", "2026-04-12T10:00:00Z");
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)").run("e1", "p1", "test", "test", "completed", "2026-04-12T09:00:00Z");
    db.prepare("INSERT INTO execution_commits (execution_id, commit_id) VALUES (?, ?)").run("e1", "c1");

    const mockRequestModel = vi.fn().mockResolvedValue(JSON.stringify({
      title: "Authentication Best Practice",
      summary: "Always use secure headers for login.",
      lesson_type: "security",
      confidence: "high"
    }));

    const extractor = new LessonExtractor(mockRequestModel);
    await extractor.extractNewLessons();

    expect(mockRequestModel).toHaveBeenCalled();
    const lesson = db.prepare("SELECT * FROM lessons WHERE prompt_id = ?").get("p1");
    expect(lesson).toBeDefined();
    expect(lesson.title).toBe("Authentication Best Practice");
  });

  it("should not learn from failed executions", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({ id: "p-failed", repo_id: "test", client: "cli", raw_prompt: "Broken task" });
    db.prepare("INSERT INTO commits (id, repo_id, sha, message, committed_at) VALUES (?, ?, ?, ?, ?)")
      .run("c-failed", "test", "sha-failed", "fix: failed attempt", "2026-04-12T10:00:00Z");
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("e-failed", "p-failed", "test", "test", "failed", "2026-04-12T09:00:00Z");
    db.prepare("INSERT INTO execution_commits (execution_id, commit_id) VALUES (?, ?)")
      .run("e-failed", "c-failed");

    const mockRequestModel = vi.fn();
    await new LessonExtractor(mockRequestModel).extractNewLessons();

    expect(mockRequestModel).not.toHaveBeenCalled();
    expect(db.prepare("SELECT * FROM lessons WHERE prompt_id = ?").get("p-failed")).toBeUndefined();
  });
});
