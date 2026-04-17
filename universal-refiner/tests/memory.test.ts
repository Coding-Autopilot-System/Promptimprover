import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LocalBrain } from "../src/memory/local-brain.js";
import { AgenticBlackboard } from "../src/core/blackboard.js";
import { getPackageVersion, getDisplayVersion } from "../src/core/version.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Memory Systems", () => {
  let tmpDir: string;
  let globalDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
    globalDir = path.join(tmpDir, ".global-refiner");
    process.env.PROMPT_REFINER_GLOBAL_DIR = globalDir;
    fs.mkdirSync(path.join(tmpDir, ".refiner"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should save and retrieve a learned pattern", () => {
    const pattern = { id: "test-pattern", category: "testing", description: "This is a test" };
    LocalBrain.savePattern(pattern, tmpDir);
    const patterns = LocalBrain.getPatterns(tmpDir);
    expect(patterns.some(p => p.id === "test-pattern")).toBe(true);
  });

  it("should approve a proposed pattern", () => {
    const pattern = { id: "proposed-1", category: "arch", description: "propose", isProposed: true };
    LocalBrain.savePattern(pattern, tmpDir);

    let patterns = LocalBrain.getPatterns(tmpDir, false);
    expect(patterns.some(p => p.id === "proposed-1")).toBe(false);

    LocalBrain.approvePattern("proposed-1", tmpDir);
    patterns = LocalBrain.getPatterns(tmpDir, false);
    expect(patterns.some(p => p.id === "proposed-1")).toBe(true);
  });

  it("should post and retrieve an active intent from blackboard", async () => {
    const intent = "Coding a new feature";
    AgenticBlackboard.postIntent("AgentA", "CLI", intent, tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    const active = AgenticBlackboard.getActiveIntents(tmpDir);
    expect(active.some(i => i.agentName === "AgentA")).toBe(true);
  });

  it("should persist project logs before notifying readers", async () => {
    AgenticBlackboard.postLog("feed-event", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    const logs = AgenticBlackboard.getLogs(tmpDir);
    expect(logs[0]?.message).toBe("feed-event");
  });

  it("should preserve feed data across a simulated module restart", async () => {
    AgenticBlackboard.postLog("restart-event", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    vi.resetModules();
    const reloaded = await import("../src/core/blackboard.js");
    const restartedLogs = reloaded.AgenticBlackboard.getLogs(tmpDir);

    expect(restartedLogs.some((log: { message: string }) => log.message === "restart-event")).toBe(true);
  });

  it("should preserve dashboard-visible state across a simulated restart", async () => {
    AgenticBlackboard.postIntent("AgentA", "CLI", "restart validation", tmpDir);
    await AgenticBlackboard.setLastRefinement("before", "after", tmpDir, 42);
    await AgenticBlackboard.flushPendingWrites();

    vi.resetModules();
    const reloaded = await import("../src/core/blackboard.js");
    const restartedIntents = reloaded.AgenticBlackboard.getActiveIntents(tmpDir);
    const restartedLogs = reloaded.AgenticBlackboard.getLogs(tmpDir);
    const restartedRefinement = reloaded.AgenticBlackboard.getLastRefinement(tmpDir);

    expect(restartedIntents.some((intent: { agentName: string }) => intent.agentName === "AgentA")).toBe(true);
    expect(restartedLogs.some((log: { message: string }) => log.message.includes("Refinement Complete"))).toBe(true);
    expect(restartedRefinement?.gain).toBe(42);
  });

  it("should isolate global history in tests", async () => {
    AgenticBlackboard.postLog("test-global-log", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    const globalFile = path.join(globalDir, "global_history.json");
    const globalData = JSON.parse(fs.readFileSync(globalFile, "utf-8"));
    expect(globalData.logs.some((log: { message: string }) => log.message === "test-global-log")).toBe(true);
  });

  it("should resolve display version from package metadata", () => {
    expect(getPackageVersion()).toBe("8.0.0");
    expect(getDisplayVersion()).toBe("v8.0.0");
  });
});
