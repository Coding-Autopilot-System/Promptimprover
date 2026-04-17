import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TimelineProvider } from "../src/history/timeline.js";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("TimelineProvider", () => {
  const testDir = path.join(os.tmpdir(), "refiner-timeline-test-" + Date.now());

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

  it("should provide a unified and sorted timeline", () => {
    const store = EventStore.getInstance();
    
    // Insert a prompt (oldest)
    store.recordPrompt({
      id: "p1", client: "cli", raw_prompt: "old prompt", timestamp: "2026-04-12T10:00:00Z"
    } as any);

    // Insert an event (newest)
    store.recordEvent({
      id: "e1", event_type: "test", summary: "new event", timestamp: "2026-04-12T12:00:00Z"
    } as any);

    const provider = new TimelineProvider();
    const timeline = provider.getUnifiedTimeline();

    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0].summary).toBe("new event");
    expect(timeline[1].type).toBe("prompt");
  });
});
