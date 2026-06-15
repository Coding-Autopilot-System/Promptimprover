import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommandCenterDashboard } from "../src/core/dashboard.js";
import { AutoPilotStatus } from "../src/core/autopilot-status.js";
import { EventStore } from "../src/history/event-store.js";

describe("/api/autopilot dashboard route (AUTO-05, AUTO-06)", () => {
  const testDir = path.join(os.tmpdir(), `refiner-autopilot-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(testDir, "global");
    (EventStore as any).instance = null;
    AutoPilotStatus.reset();
  });

  afterEach(() => {
    const instance = (EventStore as any).instance as EventStore | null;
    instance?.close();
    (EventStore as any).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
    AutoPilotStatus.reset();
  });

  it("returns idle state when no cycle has run (AUTO-05)", async () => {
    const app = CommandCenterDashboard.createApp(testDir);
    const res = await app.request("/api/autopilot");
    expect(res.status).toBe(200);
    const body = await res.json() as { state: string };
    expect(body.state).toBe("idle");
  });

  it("reflects busy state set by BackgroundAutonomyService (AUTO-05)", async () => {
    AutoPilotStatus.setBusy();
    const app = CommandCenterDashboard.createApp(testDir);
    const res = await app.request("/api/autopilot");
    const body = await res.json() as { state: string };
    expect(body.state).toBe("busy");
  });

  it("includes activity feed in response (AUTO-06)", async () => {
    AutoPilotStatus.record("Ingested 2 commits", "git_commit");
    AutoPilotStatus.record("Cycle complete", "cycle_complete");
    const app = CommandCenterDashboard.createApp(testDir);
    const res = await app.request("/api/autopilot");
    const body = await res.json() as { activity: Array<{ message: string }> };
    expect(body.activity[0].message).toBe("Cycle complete");
    expect(body.activity[1].message).toBe("Ingested 2 commits");
  });

  it("includes stats counters in response", async () => {
    AutoPilotStatus.addCommits(5);
    AutoPilotStatus.incrementCycles();
    const app = CommandCenterDashboard.createApp(testDir);
    const res = await app.request("/api/autopilot");
    const body = await res.json() as { stats: { commitsIngested: number; cyclesCompleted: number } };
    expect(body.stats.commitsIngested).toBe(5);
    expect(body.stats.cyclesCompleted).toBe(1);
  });

  it("includes lastCycleAt when a cycle has completed (AUTO-05)", async () => {
    AutoPilotStatus.setActive();
    const app = CommandCenterDashboard.createApp(testDir);
    const res = await app.request("/api/autopilot");
    const body = await res.json() as { lastCycleAt: string | null };
    expect(body.lastCycleAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
