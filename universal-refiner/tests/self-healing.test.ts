import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExecutionOrchestrator } from "../src/core/execution-orchestrator.js";
import { EventStore } from "../src/history/event-store.js";
import { AutoPilotStatus } from "../src/core/autopilot-status.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("ExecutionOrchestrator", () => {
  let store: EventStore;
  let orchestrator: ExecutionOrchestrator;
  let mockRequestText: ReturnType<typeof vi.fn>;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "self-healing-test-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = testDir;
    store = EventStore.getInstance();
    const db = (store as any).db;
    db.exec("DELETE FROM lessons; DELETE FROM executions; DELETE FROM prompts; DELETE FROM events;");
    AutoPilotStatus.reset();

    mockRequestText = vi.fn().mockResolvedValue("Healed successfully");
    orchestrator = new ExecutionOrchestrator(store, mockRequestText);
  });

  afterEach(() => {
    store.close();
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should fail gracefully if execution does not exist", async () => {
    const result = await orchestrator.healAndRetry("exec-invalid", "lesson-1");
    expect(result).toBe(false);
  });

  it("should fail gracefully if the lesson does not exist", async () => {
    store.recordPrompt({ id: "prompt-missing-lesson", repo_id: "repo-1", client: "test", raw_prompt: "Task" });
    store.recordExecution({
      id: "exec-missing-lesson",
      prompt_id: "prompt-missing-lesson",
      workflow_name: "test",
      executor_name: "test-bot",
      status: "failed",
      started_at: new Date().toISOString(),
    });

    await expect(orchestrator.healAndRetry("exec-missing-lesson", "lesson-missing")).resolves.toBe(false);
  });

  it("should require an approved lesson tied to the failed execution", async () => {
    store.recordPrompt({ id: "prompt-unapproved", repo_id: "repo-1", client: "test", raw_prompt: "Task" });
    store.recordExecution({
      id: "exec-unapproved",
      prompt_id: "prompt-unapproved",
      workflow_name: "test",
      executor_name: "test-bot",
      status: "failed",
      started_at: new Date().toISOString(),
    });
    store.recordLesson({
      id: "lesson-unapproved",
      repo_id: "repo-1",
      execution_id: "other-exec",
      lesson_type: "quality",
      title: "Lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    await expect(orchestrator.healAndRetry("exec-unapproved", "lesson-unapproved")).resolves.toBe(false);
  });

  it("should fail gracefully if the original prompt is missing", async () => {
    const db = (store as any).db;
    db.prepare("INSERT INTO executions (id, prompt_id, workflow_name, executor_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("exec-missing-prompt", "prompt-missing", "test", "test-bot", "failed", new Date().toISOString());
    store.recordLesson({
      id: "lesson-missing-prompt",
      repo_id: "repo-1",
      execution_id: "exec-missing-prompt",
      lesson_type: "quality",
      title: "Lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    await expect(orchestrator.healAndRetry("exec-missing-prompt", "lesson-missing-prompt")).resolves.toBe(false);
  });

  it("should spawn a new execution and update it to completed on success", async () => {
    store.recordPrompt({
      id: "prompt-1",
      repo_id: "repo-1",
      client: "test",
      raw_prompt: "Create login system",
    });

    store.recordExecution({
      id: "exec-failed",
      prompt_id: "prompt-1",
      workflow_name: "test",
      executor_name: "test-bot",
      status: "failed",
      started_at: new Date().toISOString(),
      result_summary: "Failed due to quotes",
    });

    const db = (store as any).db;
    db.prepare("INSERT INTO lessons (id, repo_id, execution_id, lesson_type, title, summary, confidence, source, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "lesson-1", "repo-1", "exec-failed", "correction", "Escape Quotes", "Always escape double quotes in JSON payload", "high", "agent", 1, new Date().toISOString(), new Date().toISOString()
    );

    const result = await orchestrator.healAndRetry("exec-failed", "lesson-1");
    expect(result).toBe(true);

    // Verify prompt was added
    const healPrompt = db.prepare("SELECT * FROM prompts WHERE intent = 'self-heal'").get();
    expect(healPrompt).toBeDefined();
    expect(healPrompt.raw_prompt).toContain("[HEALING: exec-failed]");
    expect(healPrompt.raw_prompt).toContain("Always escape double quotes");

    // Verify execution was added
    const healExec = db.prepare("SELECT * FROM executions WHERE prompt_id = ?").get(healPrompt.id);
    expect(healExec).toBeDefined();
    expect(healExec.status).toBe("completed");
    expect(healExec.result_summary).toBe("Healed execution succeeded.");
    
    // Verify response
    const artifacts = JSON.parse(healExec.artifacts_json);
    expect(artifacts.healedResponse).toBe("Healed successfully");
  });

  it("should mark the new execution as failed if the LLM provider fails", async () => {
    mockRequestText.mockRejectedValue(new Error("LLM Rate limit"));

    store.recordPrompt({ id: "prompt-2", repo_id: "repo-2", client: "test", raw_prompt: "Failed Prompt" });
    store.recordExecution({
      id: "exec-failed-2", prompt_id: "prompt-2", workflow_name: "test", executor_name: "test-bot", status: "failed", started_at: new Date().toISOString(),
    });
    const db = (store as any).db;
    db.prepare("INSERT INTO lessons (id, repo_id, execution_id, lesson_type, title, summary, confidence, source, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "lesson-2", "repo-2", "exec-failed-2", "correction", "Lesson 2", "Summary", "high", "agent", 1, new Date().toISOString(), new Date().toISOString()
    );

    const result = await orchestrator.healAndRetry("exec-failed-2", "lesson-2");
    expect(result).toBe(false);

    const healPrompt = db.prepare("SELECT * FROM prompts WHERE intent = 'self-heal'").get();
    const healExec = db.prepare("SELECT * FROM executions WHERE prompt_id = ?").get(healPrompt.id);
    expect(healExec.status).toBe("failed");
    expect(healExec.result_summary).toContain("LLM Rate limit");
  });

  it("should preserve non-Error provider failures in execution summaries", async () => {
    mockRequestText.mockRejectedValue("provider offline");

    store.recordPrompt({ id: "prompt-string-error", repo_id: "repo-string", client: "test", raw_prompt: "Failed Prompt" });
    store.recordExecution({
      id: "exec-string-error", prompt_id: "prompt-string-error", workflow_name: "test", executor_name: "test-bot", status: "failed", started_at: new Date().toISOString(),
    });
    store.recordLesson({
      id: "lesson-string-error",
      repo_id: "repo-string",
      execution_id: "exec-string-error",
      lesson_type: "correction",
      title: "Lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    await expect(orchestrator.healAndRetry("exec-string-error", "lesson-string-error")).resolves.toBe(false);
    const db = (store as any).db;
    const healExec = db.prepare("SELECT * FROM executions WHERE prompt_id LIKE 'prm_heal_%'").get();
    expect(healExec.result_summary).toContain("provider offline");
  });

  it("should mark the new execution as failed if the LLM provider returns null", async () => {
    mockRequestText.mockResolvedValue(null);

    store.recordPrompt({ id: "prompt-null-provider", repo_id: "repo-null", client: "test", raw_prompt: "Failed Prompt" });
    store.recordExecution({
      id: "exec-null-provider", prompt_id: "prompt-null-provider", workflow_name: "test", executor_name: "test-bot", status: "failed", started_at: new Date().toISOString(),
    });
    store.recordLesson({
      id: "lesson-null-provider",
      repo_id: "repo-null",
      execution_id: "exec-null-provider",
      lesson_type: "correction",
      title: "Lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    const result = await orchestrator.healAndRetry("exec-null-provider", "lesson-null-provider");
    expect(result).toBe(false);
  });

  it("should truncate large successful model responses before storing artifacts", async () => {
    mockRequestText.mockResolvedValue("x".repeat(9000));

    store.recordPrompt({ id: "prompt-large-provider", repo_id: "repo-large", client: "test", raw_prompt: "Failed Prompt" });
    store.recordExecution({
      id: "exec-large-provider", prompt_id: "prompt-large-provider", workflow_name: "test", executor_name: "test-bot", status: "failed", started_at: new Date().toISOString(),
    });
    store.recordLesson({
      id: "lesson-large-provider",
      repo_id: "repo-large",
      execution_id: "exec-large-provider",
      lesson_type: "correction",
      title: "Lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    await expect(orchestrator.healAndRetry("exec-large-provider", "lesson-large-provider")).resolves.toBe(true);
    const db = (store as any).db;
    const healExec = db.prepare("SELECT * FROM executions WHERE id LIKE 'exec_heal_%'").get();
    const artifacts = JSON.parse(healExec.artifacts_json);
    expect(artifacts.healedResponse).toContain("[truncated]");
    expect(artifacts.healedResponse.length).toBeLessThan(8050);
  });

  it("should block retry if max retries limit is hit", async () => {
    store.recordPrompt({ id: "prompt-3", repo_id: "repo-3", client: "test", raw_prompt: "Loop Prompt" });
    store.recordExecution({
      id: "exec-failed-3", prompt_id: "prompt-3", workflow_name: "test", executor_name: "test-bot", status: "failed", started_at: new Date().toISOString(),
    });
    const db = (store as any).db;
    db.prepare("INSERT INTO lessons (id, repo_id, execution_id, lesson_type, title, summary, confidence, source, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "lesson-3", "repo-3", "exec-failed-3", "correction", "Lesson 3", "Summary", "high", "agent", 1, new Date().toISOString(), new Date().toISOString()
    );

    // Insert fake max retries into prompts
    store.recordPrompt({
      id: "heal-attempt-1", repo_id: "repo-3", client: "test", intent: "self-heal", raw_prompt: "[HEALING: exec-failed-3] Attempt 1"
    });
    store.recordPrompt({
      id: "heal-attempt-2", repo_id: "repo-3", client: "test", intent: "self-heal", raw_prompt: "[HEALING: exec-failed-3] Attempt 2"
    });

    const result = await orchestrator.healAndRetry("exec-failed-3", "lesson-3");
    expect(result).toBe(false);
    expect(mockRequestText).not.toHaveBeenCalled();
  });

  it("should only return approved failure lessons for failed executions", () => {
    store.recordPrompt({ id: "prompt-filter-failed", repo_id: "repo-filter", client: "test", raw_prompt: "Failed" });
    store.recordExecution({
      id: "exec-filter-failed",
      prompt_id: "prompt-filter-failed",
      workflow_name: "test",
      executor_name: "test",
      status: "failed",
    });
    store.recordLesson({
      id: "lesson-filter-failed",
      repo_id: "repo-filter",
      execution_id: "exec-filter-failed",
      lesson_type: "quality",
      title: "Failed lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    store.recordPrompt({ id: "prompt-filter-complete", repo_id: "repo-filter", client: "test", raw_prompt: "Complete" });
    store.recordExecution({
      id: "exec-filter-complete",
      prompt_id: "prompt-filter-complete",
      workflow_name: "test",
      executor_name: "test",
      status: "completed",
    });
    store.recordLesson({
      id: "lesson-filter-complete",
      repo_id: "repo-filter",
      execution_id: "exec-filter-complete",
      lesson_type: "quality",
      title: "Completed lesson",
      summary: "Summary",
      confidence: "high",
      source: "auto-extracted-failure",
      approved: 1,
    });

    expect(store.getApprovedLessonsWithExecutions()).toEqual([
      { id: "lesson-filter-failed", execution_id: "exec-filter-failed" },
    ]);
  });
});
