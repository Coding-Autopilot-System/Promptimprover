import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventStore } from "../src/history/event-store.js";
import { PromptRefinerServer } from "../src/core/server.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Agent Logging & Commit Tracking", () => {
  const testDir = path.join(os.tmpdir(), "refiner-test-logging-" + Date.now());

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
    (EventStore as any).instance = null;
  });

  it("should retrieve the last commit SHA correctly", () => {
    const store = EventStore.getInstance();
    const repoId = "test-repo";
    
    // Initial state: no SHA
    expect(store.getLastCommitSha(repoId)).toBeNull();

    // Insert a commit
    store.recordCommit({
      id: "commit_1",
      repo_id: repoId,
      sha: "sha_123",
      author: "tester",
      message: "first commit",
      committed_at: "2026-04-17T09:00:00Z"
    });

    expect(store.getLastCommitSha(repoId)).toBe("sha_123");

    // Insert a newer commit
    store.recordCommit({
      id: "commit_2",
      repo_id: repoId,
      sha: "sha_456",
      author: "tester",
      message: "second commit",
      committed_at: "2026-04-17T10:00:00Z"
    });

    expect(store.getLastCommitSha(repoId)).toBe("sha_456");
  });

  it("should update and retrieve executions by prompt ID", () => {
    const store = EventStore.getInstance();
    const promptId = "ref_789";
    const execId = "exec_1";

    store.recordExecution({
      id: execId,
      prompt_id: promptId,
      workflow_name: "test-flow",
      executor_name: "tester",
      status: "started"
    });

    const exec = store.getExecutionByPromptId(promptId);
    expect(exec).toBeDefined();
    expect(exec.id).toBe(execId);
    expect(exec.status).toBe("started");

    store.updateExecution({
      id: execId,
      status: "completed",
      result_summary: "Done!"
    });

    const updated = store.getExecutionByPromptId(promptId);
    expect(updated.status).toBe("completed");
    expect(updated.result_summary).toBe("Done!");
  });
});
