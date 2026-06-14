import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileWatcher, FileChangeEvent } from "../src/watcher/file-watcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait up to `timeout` ms for `predicate` to return true, polling every `interval` ms.
 * Provides a clear assertion failure message on timeout.
 */
function waitFor(
  predicate: () => boolean,
  timeout = 6000,
  interval = 50
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error("waitFor: timeout exceeded"));
      }
    }, interval);
  });
}

/**
 * Wait for chokidar to finish setting up FS listeners.
 * Windows FSEvents/polling can need 500-1500ms before reliably firing.
 */
const WATCHER_SETTLE_MS = 1500;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("FileWatcher", () => {
  let tmpDir: string;
  let watcher: FileWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-test-"));
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // AUTO-01: detect meaningful file changes
  // -----------------------------------------------------------------------

  it("detects a file write as a 'change' event (AUTO-01)", async () => {
    // Create file before watcher starts so initial scan won't fire 'add'
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "// initial");

    const events: FileChangeEvent[] = [];
    watcher = new FileWatcher(tmpDir);
    watcher.on("change", (evt) => events.push(evt));
    watcher.start();

    // Allow chokidar to finish indexing the directory
    await new Promise((r) => setTimeout(r, WATCHER_SETTLE_MS));

    // Modify the file
    fs.writeFileSync(filePath, "// updated");

    // Wait for event
    await waitFor(() => events.some((e) => e.event === "change" && e.path.endsWith("test.ts")));

    const hit = events.find((e) => e.event === "change");
    expect(hit).toBeDefined();
    expect(hit!.path).toContain("test.ts");
    expect(hit!.timestamp).toBeInstanceOf(Date);
  }, 15_000);

  it("detects a new file as an 'add' event (AUTO-01)", async () => {
    const events: FileChangeEvent[] = [];
    watcher = new FileWatcher(tmpDir);
    watcher.on("change", (evt) => events.push(evt));
    watcher.start();

    await new Promise((r) => setTimeout(r, WATCHER_SETTLE_MS));

    fs.writeFileSync(path.join(tmpDir, "new.ts"), "export {}");

    await waitFor(() => events.some((e) => e.event === "add" && e.path.endsWith("new.ts")));

    const hit = events.find((e) => e.event === "add");
    expect(hit).toBeDefined();
    expect(hit!.event).toBe("add");
    expect(hit!.timestamp).toBeInstanceOf(Date);
  }, 15_000);

  // -----------------------------------------------------------------------
  // AUTO-02: noise filter
  // -----------------------------------------------------------------------

  it("does NOT emit events for paths inside node_modules (AUTO-02)", async () => {
    const nmDir = path.join(tmpDir, "node_modules", "some-pkg");
    fs.mkdirSync(nmDir, { recursive: true });

    const events: FileChangeEvent[] = [];
    watcher = new FileWatcher(tmpDir);
    watcher.on("change", (evt) => events.push(evt));
    watcher.start();

    await new Promise((r) => setTimeout(r, WATCHER_SETTLE_MS));

    fs.writeFileSync(path.join(nmDir, "index.ts"), "// ignored");

    // Wait and assert silence
    await new Promise((r) => setTimeout(r, 800));
    const nmEvents = events.filter((e) => e.path.includes("node_modules"));
    expect(nmEvents).toHaveLength(0);
  }, 15_000);

  it("does NOT emit events for *.log files (AUTO-02)", async () => {
    const events: FileChangeEvent[] = [];
    watcher = new FileWatcher(tmpDir);
    watcher.on("change", (evt) => events.push(evt));
    watcher.start();

    await new Promise((r) => setTimeout(r, WATCHER_SETTLE_MS));

    fs.writeFileSync(path.join(tmpDir, "debug.log"), "some log line");

    await new Promise((r) => setTimeout(r, 800));
    expect(events.filter((e) => e.path.endsWith(".log"))).toHaveLength(0);
  }, 15_000);

  // -----------------------------------------------------------------------
  // stop() — no further events after stop
  // -----------------------------------------------------------------------

  it("stop() prevents further events from being emitted", async () => {
    const filePath = path.join(tmpDir, "track.ts");
    fs.writeFileSync(filePath, "// v1");

    const events: FileChangeEvent[] = [];
    watcher = new FileWatcher(tmpDir);
    watcher.on("change", (evt) => events.push(evt));
    watcher.start();

    await new Promise((r) => setTimeout(r, WATCHER_SETTLE_MS));
    await watcher.stop();

    const countBefore = events.length;
    fs.writeFileSync(filePath, "// v2");
    await new Promise((r) => setTimeout(r, 800));

    expect(events.length).toBe(countBefore);
  }, 15_000);
});
