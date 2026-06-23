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

  it("does not record a lesson when the model is unavailable or returns malformed output", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({ id: "p-model", repo_id: "test", client: "cli", raw_prompt: "Create model test" });
    store.recordCommit({
      id: "c-model",
      repo_id: "test",
      sha: "sha-model",
      author: "test",
      message: "test: model",
      committed_at: "2026-04-12T10:00:00Z",
    });
    store.recordExecution({
      id: "e-model",
      prompt_id: "p-model",
      workflow_name: "test",
      executor_name: "test",
      status: "completed",
    });
    store.linkCommitToExecution("e-model", "c-model");

    const request = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("not json");
    const extractor = new LessonExtractor(request);
    await extractor.extractNewLessons();
    await extractor.extractNewLessons();

    expect(request).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT * FROM lessons WHERE prompt_id = ?").get("p-model")).toBeUndefined();
  });

  it("should extract a lesson from a failed execution via extractFailureLessons", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({ id: "p-fail-test", repo_id: "test", client: "cli", raw_prompt: "Bad task" });
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at, result_summary) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("e-fail-test", "p-fail-test", "test", "test", "failed", "2026-04-12T09:00:00Z", "TypeError: foo is undefined");

    const mockRequestModel = vi.fn().mockResolvedValue(JSON.stringify({
      title: "Avoid undefined errors",
      summary: "Always check for undefined before accessing properties.",
      lesson_type: "quality",
      confidence: "high"
    }));

    const extractor = new LessonExtractor(mockRequestModel);
    await extractor.extractFailureLessons();

    expect(mockRequestModel).toHaveBeenCalled();
    const lesson = db.prepare("SELECT * FROM lessons WHERE prompt_id = ?").get("p-fail-test");
    expect(lesson).toBeDefined();
    expect(lesson.title).toBe("Avoid undefined errors");
    expect(lesson.source).toBe("auto-extracted-failure");
  });

  it("redacts and caps failed execution context before model analysis", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    const fakeToken = "ghp_" + "abcdefghijklmnopqrstuvwxyz123456";
    store.recordPrompt({
      id: "p-fail-secret",
      repo_id: "test",
      client: "cli",
      raw_prompt: `Use token=secret-value and ${"x".repeat(5000)} ${fakeToken}`,
    });
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at, result_summary, artifacts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("e-fail-secret", "p-fail-secret", "test", "test", "failed", "2026-04-12T09:00:00Z", "password=hunter2", "{");

    const mockRequestModel = vi.fn().mockResolvedValue(JSON.stringify({
      title: "Redacted lesson",
      summary: "Avoid leaking secrets.",
      lesson_type: "security",
      confidence: "high"
    }));

    await new LessonExtractor(mockRequestModel).extractFailureLessons();

    const modelPrompt = mockRequestModel.mock.calls[0][1] as string;
    expect(modelPrompt).toContain("[REDACTED]");
    expect(modelPrompt).toContain("[truncated]");
    expect(modelPrompt).not.toContain("secret-value");
    expect(modelPrompt).not.toContain("hunter2");
    expect(modelPrompt).not.toContain(fakeToken);
  });

  it("handles empty artifact summaries during failure lesson extraction", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({ id: "p-fail-empty-artifacts", repo_id: "test", client: "cli", raw_prompt: "Task" });
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at, result_summary, artifacts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("e-fail-empty-artifacts", "p-fail-empty-artifacts", "test", "test", "failed", "2026-04-12T09:00:00Z", "Error", "");

    const mockRequestModel = vi.fn().mockResolvedValue(JSON.stringify({
      title: "Empty artifacts",
      summary: "Handle empty artifacts.",
      lesson_type: "quality",
      confidence: "medium"
    }));

    await new LessonExtractor(mockRequestModel).extractFailureLessons();

    expect(mockRequestModel.mock.calls[0][1]).toContain("ARTIFACTS / ADDITIONAL CONTEXT:\n{}");
  });

  it("handles failed executions without repo IDs or result summaries", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({ id: "p-fail-no-repo", client: "cli", raw_prompt: "Task without repo" });
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("e-fail-no-repo", "p-fail-no-repo", "test", "test", "failed", "2026-04-12T09:00:00Z");

    const mockRequestModel = vi.fn().mockResolvedValue(JSON.stringify({
      title: "No repo",
      summary: "Handle missing repo metadata.",
      lesson_type: "quality",
      confidence: "low"
    }));

    await new LessonExtractor(mockRequestModel).extractFailureLessons();

    const lesson = db.prepare("SELECT * FROM lessons WHERE prompt_id = ?").get("p-fail-no-repo");
    expect(lesson.id).toMatch(/^lsn_[a-f0-9]{24}$/);
    expect(mockRequestModel.mock.calls[0][1]).toContain("ERROR OR RESULT SUMMARY:\n");
  });

  it("does not record a failure lesson when the model is unavailable or returns malformed output", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({ id: "p-fail-model", repo_id: "test", client: "cli", raw_prompt: "Task 2" });
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at, result_summary) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("e-fail-model", "p-fail-model", "test", "test", "failed", "2026-04-12T09:00:00Z", "Error");

    const request = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("not json");
    const extractor = new LessonExtractor(request);
    await extractor.extractFailureLessons();
    await extractor.extractFailureLessons();

    expect(request).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT * FROM lessons WHERE prompt_id = ?").get("p-fail-model")).toBeUndefined();
  });
});
