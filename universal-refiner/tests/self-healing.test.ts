import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExecutionOrchestrator } from "../src/core/execution-orchestrator.js";
import { EventStore } from "../src/history/event-store.js";
import { AutoPilotStatus } from "../src/core/autopilot-status.js";
import * as fs from "fs";

describe("ExecutionOrchestrator", () => {
  let store: EventStore;
  let orchestrator: ExecutionOrchestrator;
  let mockRequestText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = EventStore.getInstance();
    const db = (store as any).db;
    db.exec("DELETE FROM lessons; DELETE FROM executions; DELETE FROM prompts; DELETE FROM events;");
    AutoPilotStatus.reset();

    mockRequestText = vi.fn().mockResolvedValue("Healed successfully");
    orchestrator = new ExecutionOrchestrator(store, mockRequestText);
  });

  it("should fail gracefully if execution does not exist", async () => {
    const result = await orchestrator.healAndRetry("exec-invalid", "lesson-1");
    expect(result).toBe(false);
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
});
