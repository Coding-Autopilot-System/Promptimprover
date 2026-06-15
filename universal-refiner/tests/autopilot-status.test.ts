import { describe, it, expect, beforeEach } from "vitest";
import { AutoPilotStatus } from "../src/core/autopilot-status.js";

describe("AutoPilotStatus", () => {
  beforeEach(() => {
    AutoPilotStatus.reset();
  });

  // -------------------------------------------------------------------------
  // AUTO-05: status indicator transitions
  // -------------------------------------------------------------------------

  it("starts in 'idle' state (AUTO-05)", () => {
    expect(AutoPilotStatus.getSnapshot().state).toBe("idle");
  });

  it("transitions idle → busy → active (AUTO-05)", () => {
    AutoPilotStatus.setBusy();
    expect(AutoPilotStatus.getSnapshot().state).toBe("busy");

    AutoPilotStatus.setActive();
    expect(AutoPilotStatus.getSnapshot().state).toBe("active");
  });

  it("setActive records lastCycleAt timestamp (AUTO-05)", () => {
    expect(AutoPilotStatus.getSnapshot().lastCycleAt).toBeNull();
    AutoPilotStatus.setActive();
    expect(AutoPilotStatus.getSnapshot().lastCycleAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("setIdle returns to idle from any state (AUTO-05)", () => {
    AutoPilotStatus.setBusy();
    AutoPilotStatus.setIdle();
    expect(AutoPilotStatus.getSnapshot().state).toBe("idle");
  });

  // -------------------------------------------------------------------------
  // AUTO-06: activity feed
  // -------------------------------------------------------------------------

  it("record() prepends entries to the activity feed (AUTO-06)", () => {
    AutoPilotStatus.record("Cycle started", "cycle_start");
    AutoPilotStatus.record("Ingested 3 commits", "git_commit");

    const { activity } = AutoPilotStatus.getSnapshot();
    expect(activity[0].message).toBe("Ingested 3 commits");
    expect(activity[1].message).toBe("Cycle started");
  });

  it("activity entries carry ISO timestamp and kind (AUTO-06)", () => {
    AutoPilotStatus.record("File changed", "file_change");
    const { activity } = AutoPilotStatus.getSnapshot();
    expect(activity[0].kind).toBe("file_change");
    expect(activity[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("activity feed is capped at 50 entries (AUTO-06)", () => {
    for (let i = 0; i < 60; i++) {
      AutoPilotStatus.record(`event ${i}`, "cycle_complete");
    }
    const { activity } = AutoPilotStatus.getSnapshot(60);
    expect(activity.length).toBe(50);
  });

  it("getSnapshot(maxActivity) limits the returned slice (AUTO-06)", () => {
    for (let i = 0; i < 30; i++) {
      AutoPilotStatus.record(`event ${i}`, "cycle_complete");
    }
    expect(AutoPilotStatus.getSnapshot(5).activity.length).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Stats counters
  // -------------------------------------------------------------------------

  it("addCommits accumulates across calls", () => {
    AutoPilotStatus.addCommits(3);
    AutoPilotStatus.addCommits(5);
    expect(AutoPilotStatus.getSnapshot().stats.commitsIngested).toBe(8);
  });

  it("addLessons accumulates across calls", () => {
    AutoPilotStatus.addLessons(2);
    AutoPilotStatus.addLessons(1);
    expect(AutoPilotStatus.getSnapshot().stats.lessonsExtracted).toBe(3);
  });

  it("incrementCycles counts completed cycles", () => {
    AutoPilotStatus.incrementCycles();
    AutoPilotStatus.incrementCycles();
    expect(AutoPilotStatus.getSnapshot().stats.cyclesCompleted).toBe(2);
  });

  // -------------------------------------------------------------------------
  // reset() for test isolation
  // -------------------------------------------------------------------------

  it("reset() returns to initial state", () => {
    AutoPilotStatus.setBusy();
    AutoPilotStatus.addCommits(10);
    AutoPilotStatus.record("something", "error");
    AutoPilotStatus.reset();

    const snap = AutoPilotStatus.getSnapshot();
    expect(snap.state).toBe("idle");
    expect(snap.lastCycleAt).toBeNull();
    expect(snap.activity).toHaveLength(0);
    expect(snap.stats.commitsIngested).toBe(0);
  });
});
