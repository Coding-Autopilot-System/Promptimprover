import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CorrelationEngine } from "../src/history/correlation-engine.js";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("CorrelationEngine", () => {
  const testDir = path.join(os.tmpdir(), "refiner-correlation-test-" + Date.now());

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

  it("should correlate a commit with a relevant prompt", async () => {
    const store = EventStore.getInstance();
    
    // 1. Record a prompt
    store.recordPrompt({
      id: "p1",
      repo_id: "test-repo",
      client: "test",
      raw_prompt: "Implement a new authentication system using JWT",
      timestamp: "2026-04-12T10:00:00Z"
    });

    // 2. Record a commit that happens later and mentions keywords
    const db = (store as any).db;
    db.prepare(`
      INSERT INTO commits (id, repo_id, sha, author, message, committed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("c1", "test-repo", "sha1", "author", "feat: add JWT authentication", "2026-04-12T10:15:00Z");

    const engine = new CorrelationEngine();
    await engine.correlateAll();

    // 3. Verify the link
    const link = db.prepare("SELECT * FROM execution_commits WHERE commit_id = ?").get("c1");
    expect(link).toBeDefined();

    const execution = db.prepare("SELECT * FROM executions WHERE id = ?").get(link.execution_id);
    expect(execution.prompt_id).toBe("p1");

    const event = db.prepare("SELECT * FROM events WHERE event_type = ?").get("commit_correlated");
    expect(event).toBeDefined();
    expect(event.prompt_id).toBe("p1");
  });

  it("should not correlate unrelated commits", async () => {
    const store = EventStore.getInstance();
    
    store.recordPrompt({
      id: "p_unrelated",
      repo_id: "test-repo",
      client: "test",
      raw_prompt: "Fix bug in logging",
      timestamp: "2026-04-12T10:00:00Z"
    });

    const db = (store as any).db;
    db.prepare(`
      INSERT INTO commits (id, repo_id, sha, author, message, committed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("c_unrelated", "test-repo", "sha2", "author", "docs: update readme", "2026-04-12T10:15:00Z");

    const engine = new CorrelationEngine();
    await engine.correlateAll();

    const link = db.prepare("SELECT * FROM execution_commits WHERE commit_id = ?").get("c_unrelated");
    expect(link).toBeUndefined();
  });

  it("leaves a commit unlinked when there are no prompt candidates", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    db.prepare("INSERT INTO commits (id, repo_id, sha, author, message, committed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("orphan", "repo", "sha-orphan", "author", "feat: orphan", "2026-04-12T10:00:00Z");

    await new CorrelationEngine().correlateAll();

    expect(db.prepare("SELECT * FROM execution_commits WHERE commit_id = ?").get("orphan")).toBeUndefined();
  });

  it("uses file awareness and an existing execution when correlating", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({
      id: "file-prompt",
      repo_id: "repo",
      client: "test",
      raw_prompt: "Update target.ts and docs",
      normalized_prompt: "Modify target.ts",
      timestamp: "2026-04-12T10:00:00Z",
    });
    store.recordExecution({
      id: "existing-execution",
      prompt_id: "file-prompt",
      workflow_name: "manual",
      executor_name: "test",
      status: "completed",
    });
    db.prepare("INSERT INTO commits (id, repo_id, sha, author, message, committed_at, changed_files_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("file-commit", "repo", "sha-file", "author", "chore: unrelated wording", "2026-04-12T10:01:00Z", JSON.stringify(["src/target.ts", "/", "a"]));

    await new CorrelationEngine().correlateAll();

    expect(db.prepare("SELECT execution_id FROM execution_commits WHERE commit_id = ?").get("file-commit"))
      .toEqual({ execution_id: "existing-execution" });
  });

  it("tolerates malformed changed files while correlating by content", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({
      id: "short-prompt",
      repo_id: "repo",
      client: "test",
      raw_prompt: "matching change",
      timestamp: "2026-04-12T10:00:00Z",
    });
    db.prepare("INSERT INTO commits (id, repo_id, sha, author, message, committed_at, changed_files_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("malformed-commit", "repo", "sha-malformed", "author", "matching change", "2026-04-12T10:01:00Z", "{");

    await new CorrelationEngine().correlateAll();

    expect(db.prepare("SELECT * FROM execution_commits WHERE commit_id = ?").get("malformed-commit")).toBeDefined();
  });

  it("evaluates but does not correlate a prompt with no usable keywords", async () => {
    const store = EventStore.getInstance();
    const db = (store as any).db;
    store.recordPrompt({
      id: "short-prompt",
      repo_id: "repo",
      client: "test",
      raw_prompt: "a to an",
      timestamp: "2026-04-12T10:00:00Z",
    });
    db.prepare("INSERT INTO commits (id, repo_id, sha, author, message, committed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("short-commit", "repo", "sha-short", "author", "anything", "2026-04-12T10:01:00Z");

    await new CorrelationEngine().correlateAll();

    expect(db.prepare("SELECT * FROM execution_commits WHERE commit_id = ?").get("short-commit")).toBeUndefined();
  });

  it("uses an empty changed-file list when defensive input omits it", () => {
    const engine = new CorrelationEngine();
    const candidate = {
      id: "defensive-prompt",
      raw_prompt: "matching change",
      normalized_prompt: null,
      intent: null,
      timestamp: "2026-04-12T10:00:00Z",
    };
    (engine as any).eventStore = {
      db: {
        prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([candidate]) }),
      },
    };

    expect((engine as any).findBestPromptMatch({
      repo_id: "repo",
      committed_at: "2026-04-12T10:01:00Z",
      message: "matching change",
      changed_files_json: null,
    })).toBe(candidate);
  });
});
