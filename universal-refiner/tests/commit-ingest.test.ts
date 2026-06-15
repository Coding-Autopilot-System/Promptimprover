import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommitIngester } from "../src/history/commit-ingest.js";
import { EventStore } from "../src/history/event-store.js";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("child_process", () => ({
  execFileSync: vi.fn()
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
    
    (execFileSync as any).mockImplementation((_file: string, args: string[]) => {
      if (args.includes("log")) return mockLog;
      if (args.includes("--shortstat")) return mockStats;
      if (args.includes("--name-only")) return mockFiles;
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

  it("fails quietly and returns zero for a non-git directory", async () => {
    const gitError = new Error("not a git repository");
    (execFileSync as any).mockImplementation(() => {
      throw gitError;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const ingester = new CommitIngester();
    const count = await ingester.ingest(testDir, 1);

    expect(count).toBe(0);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["log", "-n", "1", "--pretty=format:%H|%an|%ai|%s"],
      expect.objectContaining({
        cwd: testDir,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
