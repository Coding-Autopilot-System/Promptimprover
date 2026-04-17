import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommitIngester } from "../src/history/commit-ingest.js";
import { EventStore } from "../src/history/event-store.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("child_process", () => ({
  execSync: vi.fn()
}));

describe("CommitIngester", () => {
  const testDir = path.join(os.tmpdir(), "refiner-commit-test-" + Date.now());

  beforeEach(() => {
    process.env.PROMPT_REFINER_GLOBAL_DIR = testDir;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Re-initialize EventStore for each test
    (EventStore as any).instance = null;
  });

  afterEach(() => {
    const store = EventStore.getInstance();
    store.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should ingest commits from a repo with stats", async () => {
    const mockLog = "sha123|author_name|2026-04-12|Commit message";
    const mockFiles = "file1.ts\nfile2.ts";
    const mockStats = " 2 files changed, 15 insertions(+), 5 deletions(-)";
    
    (execSync as any).mockImplementation((cmd: string) => {
      if (cmd.includes("git log")) return mockLog;
      if (cmd.includes("git show --shortstat")) return mockStats;
      if (cmd.includes("git show --name-only")) return mockFiles;
      return "";
    });

    const ingester = new CommitIngester();
    const count = await ingester.ingest("C:/repo/test-repo", 1);

    expect(count).toBe(1);

    const store = EventStore.getInstance();
    const db = (store as any).db;
    const row = db.prepare("SELECT * FROM commits WHERE sha = ?").get("sha123");
    
    expect(row).toBeDefined();
    expect(row.author).toBe("author_name");
    expect(row.message).toBe("Commit message");
    expect(JSON.parse(row.changed_files_json)).toEqual(["file1.ts", "file2.ts"]);
    
    const stats = JSON.parse(row.diff_stats_json);
    expect(stats.insertions).toBe(15);
    expect(stats.deletions).toBe(5);
  });
});
