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
});
