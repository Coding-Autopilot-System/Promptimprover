import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("EventStore", () => {
  const testDir = path.join(os.tmpdir(), "refiner-test-" + Date.now());

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
    // Reset singleton for next test
    (EventStore as any).instance = null;
  });

  it("should initialize the database and schema", () => {
    const store = EventStore.getInstance();
    const dbPath = path.join(testDir, "events.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("should record an event", () => {
    const store = EventStore.getInstance();
    const event = {
      id: "evt_1",
      event_type: "test_event",
      summary: "Test event summary",
      details_json: JSON.stringify({ foo: "bar" })
    };

    store.recordEvent(event);

    // Verify by querying directly (using private db access for test)
    const db = (store as any).db;
    const row = db.prepare("SELECT * FROM events WHERE id = ?").get("evt_1");
    
    expect(row).toBeDefined();
    expect(row.event_type).toBe("test_event");
    expect(row.summary).toBe("Test event summary");
    expect(JSON.parse(row.details_json)).toEqual({ foo: "bar" });
  });

  it("should record a prompt and an associated event", () => {
    const store = EventStore.getInstance();
    const prompt = {
      id: "prm_1",
      client: "test_client",
      raw_prompt: "Hello world",
      intent: "testing"
    };

    store.recordPrompt(prompt);

    const db = (store as any).db;
    const pRow = db.prepare("SELECT * FROM prompts WHERE id = ?").get("prm_1");
    expect(pRow).toBeDefined();
    expect(pRow.raw_prompt).toBe("Hello world");
    expect(pRow.intent).toBe("testing");

    const eRow = db.prepare("SELECT * FROM events WHERE prompt_id = ?").get("prm_1");
    expect(eRow).toBeDefined();
    expect(eRow.event_type).toBe("prompt_received");
  });
});
