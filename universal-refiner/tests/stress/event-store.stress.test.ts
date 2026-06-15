import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../src/history/event-store.js";

describe("EventStore stress and restart persistence", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "event-store-stress-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = directory;
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
  });

  afterEach(() => {
    const holder = EventStore as unknown as { instance: EventStore | null };
    holder.instance?.close();
    holder.instance = null;
    rmSync(directory, { recursive: true, force: true });
  });

  it("preserves all operations submitted concurrently", async () => {
    const store = EventStore.getInstance();
    const operations = Array.from({ length: 500 }, (_, index) => Promise.resolve().then(() => {
      store.recordEvent({ id: `concurrent-${index}`, event_type: "stress", summary: `event ${index}` });
    }));

    await Promise.all(operations);

    const db = (store as unknown as { db: { prepare: (sql: string) => { get: () => { count: number } } } }).db;
    expect(db.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'stress'").get().count).toBe(500);
  });

  it("retains events after the store is closed and reopened", () => {
    const holder = EventStore as unknown as { instance: EventStore | null };
    const first = EventStore.getInstance();
    first.recordEvent({ id: "before-restart", event_type: "restart", summary: "persist me" });
    first.close();
    holder.instance = null;

    const restarted = EventStore.getInstance();
    const db = (restarted as unknown as { db: { prepare: (sql: string) => { get: (id: string) => unknown } } }).db;
    expect(db.prepare("SELECT id FROM events WHERE id = ?").get("before-restart")).toEqual({ id: "before-restart" });
  });

  it("creates an integrity-checked backup and restores it", async () => {
    const store = EventStore.getInstance();
    const backupPath = join(directory, "backups", "events.db");
    store.recordEvent({ id: "before-backup", event_type: "recovery", summary: "restore me" });

    await expect(store.backup(backupPath)).resolves.toBe(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    store.recordEvent({ id: "after-backup", event_type: "recovery", summary: "discard me" });

    const restored = EventStore.restore(backupPath);
    const db = (restored as unknown as { db: { prepare: (sql: string) => { get: (id: string) => unknown } } }).db;
    expect(db.prepare("SELECT id FROM events WHERE id = ?").get("before-backup")).toEqual({ id: "before-backup" });
    expect(db.prepare("SELECT id FROM events WHERE id = ?").get("after-backup")).toBeUndefined();
  });

  it("rejects a missing backup", () => {
    expect(() => EventStore.restore(join(directory, "missing.db"))).toThrow(/Backup does not exist/);
  });
});
