import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileWatcher, FileChangeEvent } from "../src/watcher/file-watcher.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 6000, pollInterval = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) {
      return;
    }
    await delay(pollInterval);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe("FileWatcher", () => {
  let tmpDir: string;
  let watcher: FileWatcher;
  let events: FileChangeEvent[] = [];

  beforeEach(async () => {
    events = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-watcher-test-"));
    watcher = new FileWatcher(tmpDir);
    
    watcher.on("change", (evt: FileChangeEvent) => {
      events.push(evt);
    });

    await watcher.start();
    // Allow Windows FS listener warm-up
    await delay(1500);
  });

  afterEach(async () => {
    await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits 'add' when a new .ts file is written", async () => {
    const testFile = path.join(tmpDir, "test.ts");
    fs.writeFileSync(testFile, "const x = 1;", "utf-8");

    await waitFor(() => events.length > 0);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe("add");
    expect(events[0].path).toBe(testFile);
  }, 15000);

  it("emits 'change' when an existing .ts file is updated", async () => {
    const testFile = path.join(tmpDir, "update.ts");
    // Pre-create file, then warm up
    fs.writeFileSync(testFile, "const x = 1;", "utf-8");
    // Wait for the 'add' event from creation to settle or ignore it
    await delay(500);
    events = []; // clear events

    fs.writeFileSync(testFile, "const x = 2;", "utf-8");

    await waitFor(() => events.length > 0);

    expect(events.length).toBeGreaterThan(0);
    // Some OSes might emit "change", some might emit "add" and "change".
    // Chokidar handles this with awaitWriteFinish, so we should see "change".
    const changeEvent = events.find(e => e.event === "change");
    expect(changeEvent).toBeDefined();
    expect(changeEvent?.path).toBe(testFile);
  }, 15000);

  it("ignores files in node_modules", async () => {
    const nmDir = path.join(tmpDir, "node_modules");
    fs.mkdirSync(nmDir);
    const testFile = path.join(nmDir, "ignored.ts");

    fs.writeFileSync(testFile, "const y = 1;", "utf-8");

    await delay(2000); // Wait enough time for event to fire if it was going to
    expect(events).toHaveLength(0);
  }, 15000);

  it("ignores .log files", async () => {
    const testFile = path.join(tmpDir, "app.log");

    fs.writeFileSync(testFile, "some log data", "utf-8");

    await delay(2000);
    expect(events).toHaveLength(0);
  }, 15000);

  it("prevents any further events after stop() is called", async () => {
    await watcher.stop();
    
    const testFile = path.join(tmpDir, "after-stop.ts");
    fs.writeFileSync(testFile, "const z = 1;", "utf-8");

    await delay(2000);
    expect(events).toHaveLength(0);
  }, 15000);
});
