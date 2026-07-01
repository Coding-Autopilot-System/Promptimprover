import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgenticBlackboard, type AgentIntent, type SystemLog } from "../src/core/blackboard.js";
import { RuntimeLogger } from "../src/core/logger.js";

describe("AgenticBlackboard", () => {
  let tmpDir: string;
  let globalDir: string;

  beforeEach(async () => {
    await AgenticBlackboard.flushPendingWrites();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blackboard-test-"));
    fs.mkdirSync(path.join(tmpDir, ".refiner"));
    globalDir = path.join(tmpDir, "global");
    process.env.PROMPT_REFINER_GLOBAL_DIR = globalDir;
  });

  afterEach(async () => {
    await AgenticBlackboard.flushPendingWrites();
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    vi.restoreAllMocks();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores nested-project activity at the nearest project root", async () => {
    const project = path.join(tmpDir, "project");
    const nested = path.join(project, "src", "feature");
    fs.mkdirSync(path.join(project, ".refiner"), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });

    AgenticBlackboard.postLog("nested activity", nested);
    await AgenticBlackboard.flushPendingWrites();

    const storagePath = path.join(project, ".refiner", "blackboard.json");
    expect(fs.existsSync(storagePath)).toBe(true);
    expect(fs.existsSync(path.join(nested, ".refiner"))).toBe(false);
    expect(AgenticBlackboard.getLogs(nested)[0]?.message).toBe("nested activity");
  });

  it("initializes missing collections, bounds histories, and de-duplicates projects", async () => {
    const refinerDir = path.join(tmpDir, ".refiner");
    const storagePath = path.join(refinerDir, "blackboard.json");
    const globalPath = path.join(globalDir, "global_history.json");
    const projectPath = path.resolve(tmpDir);
    const projectLogs = Array.from({ length: 200 }, (_, index): SystemLog => ({
      timestamp: new Date(0).toISOString(),
      message: `project-${index}`,
    }));
    const globalLogs = Array.from({ length: 500 }, (_, index): SystemLog => ({
      timestamp: new Date(0).toISOString(),
      message: `global-${index}`,
    }));
    fs.mkdirSync(refinerDir, { recursive: true });
    fs.mkdirSync(globalDir);
    fs.writeFileSync(storagePath, JSON.stringify({ activeIntents: [], logs: projectLogs }));
    fs.writeFileSync(globalPath, JSON.stringify({ logs: globalLogs, projects: [projectPath] }));

    AgenticBlackboard.postLog("bounded", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    expect(AgenticBlackboard.getLogs(tmpDir)).toHaveLength(200);
    expect(AgenticBlackboard.getGlobalData()).toMatchObject({
      logs: expect.arrayContaining([expect.objectContaining({ message: "bounded" })]),
      projects: [projectPath],
    });
    expect(AgenticBlackboard.getGlobalData().logs).toHaveLength(500);

    fs.writeFileSync(storagePath, "{}");
    fs.writeFileSync(globalPath, "{}");
    AgenticBlackboard.postLog("initialize arrays", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    expect(AgenticBlackboard.getLogs(tmpDir)[0]?.message).toBe("initialize arrays");
    expect(AgenticBlackboard.getGlobalData().projects).toEqual([projectPath]);
  });

  it("notifies healthy listeners, isolates failing listeners, and supports unsubscribe", async () => {
    const healthy = vi.fn();
    const failing = vi.fn(() => {
      throw new Error("listener failed");
    });
    const error = vi.spyOn(RuntimeLogger, "error").mockImplementation(() => undefined);
    const unsubscribeHealthy = AgenticBlackboard.onUpdate(healthy);
    const unsubscribeFailing = AgenticBlackboard.onUpdate(failing);

    AgenticBlackboard.postLog("first", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    expect(healthy).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("Listener notification failed", expect.any(Error));

    unsubscribeHealthy();
    unsubscribeFailing();
    AgenticBlackboard.postLog("second", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    expect(healthy).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledOnce();
  });

  it("replaces duplicate intents, removes expired intents, and preserves other active agents", async () => {
    const refinerDir = path.join(tmpDir, ".refiner");
    const storagePath = path.join(refinerDir, "blackboard.json");
    const active = (agentName: string, expiresAt: string): AgentIntent => ({
      agentName,
      toolType: "CLI",
      intent: "existing",
      timestamp: new Date(0).toISOString(),
      expiresAt,
    });
    fs.mkdirSync(refinerDir, { recursive: true });
    fs.writeFileSync(storagePath, JSON.stringify({
      logs: [],
      activeIntents: [
        active("expired", new Date(0).toISOString()),
        active("replacement", new Date(Date.now() + 60_000).toISOString()),
        active("other", new Date(Date.now() + 60_000).toISOString()),
      ],
    }));

    const created = AgenticBlackboard.postIntent("replacement", "lint", "x".repeat(80), tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    expect(created.projectPath).toBe(path.resolve(tmpDir));
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(AgenticBlackboard.getActiveIntents(tmpDir).map(intent => intent.agentName)).toEqual([
      "other",
      "replacement",
    ]);
    expect(AgenticBlackboard.getLogs(tmpDir)[0]?.message).toContain(`${"x".repeat(50)}...`);

    fs.writeFileSync(storagePath, "{}");
    AgenticBlackboard.postIntent("fresh", "lint", "new", tmpDir);
    await AgenticBlackboard.flushPendingWrites();
    expect(AgenticBlackboard.getActiveIntents(tmpDir).map(intent => intent.agentName)).toEqual(["fresh"]);
  });

  it("returns safe fallbacks for missing, malformed, and incomplete project data", () => {
    const error = vi.spyOn(RuntimeLogger, "error").mockImplementation(() => undefined);

    expect(AgenticBlackboard.getLogs(tmpDir)).toEqual([]);
    expect(AgenticBlackboard.getActiveIntents(tmpDir)).toEqual([]);
    expect(AgenticBlackboard.getLastRefinement(tmpDir)).toBeNull();

    const refinerDir = path.join(tmpDir, ".refiner");
    fs.mkdirSync(refinerDir, { recursive: true });
    fs.writeFileSync(path.join(refinerDir, "blackboard.json"), "{");

    expect(AgenticBlackboard.getLogs(tmpDir)).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Failed to read JSON file"), expect.any(Error));

    fs.writeFileSync(path.join(refinerDir, "blackboard.json"), "{}");
    expect(AgenticBlackboard.getLogs(tmpDir)).toEqual([]);
    expect(AgenticBlackboard.getActiveIntents(tmpDir)).toEqual([]);
    expect(AgenticBlackboard.getLastRefinement(tmpDir)).toBeNull();
  });

  it("persists and returns the latest refinement with default gain", async () => {
    await AgenticBlackboard.setLastRefinement("before", "after", tmpDir);
    await AgenticBlackboard.flushPendingWrites();

    expect(AgenticBlackboard.getLastRefinement(tmpDir)).toMatchObject({
      original: "before",
      refined: "after",
      gain: 0,
    });
    expect(AgenticBlackboard.getLogs(tmpDir)[0]?.message).toBe("Refinement Complete (Gain: 0%)");
  });

  it("logs and recovers from project-root and storage failures", async () => {
    const error = vi.spyOn(RuntimeLogger, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(RuntimeLogger, "warn").mockImplementation(() => undefined);
    const blockedProject = path.join(tmpDir, "blocked-project");
    fs.mkdirSync(blockedProject);
    fs.writeFileSync(path.join(blockedProject, ".refiner"), "not a directory");
    fs.writeFileSync(globalDir, "not a directory");

    AgenticBlackboard.postLog("cannot persist", blockedProject);
    await AgenticBlackboard.setLastRefinement("before", "after", blockedProject, 5);
    await AgenticBlackboard.flushPendingWrites();

    expect(AgenticBlackboard.getGlobalData()).toEqual({ logs: [], projects: [] });
    expect(error).toHaveBeenCalledWith("Failed to ensure project blackboard storage", expect.any(Error));
    expect(error).toHaveBeenCalledWith("Failed to ensure global blackboard storage", expect.any(Error));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Atomic update failed"), expect.any(Error));

    expect(Array.isArray(AgenticBlackboard.getLogs(null as unknown as string))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to resolve project root"), expect.any(Error));
  });

  it("uses the home-directory global store when no override is configured", () => {
    const previousHome = process.env.HOME;
    const previousProfile = process.env.USERPROFILE;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    delete process.env.PROMPT_REFINER_PROJECT_DIR;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    try {
      const data = AgenticBlackboard.getGlobalData();
      expect(data).toHaveProperty("logs");
      expect(data).toHaveProperty("projects");
      expect(Array.isArray(AgenticBlackboard.getLogs("."))).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("uses the isolated project fallback when only project storage is configured", () => {
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    process.env.PROMPT_REFINER_PROJECT_DIR = tmpDir;

    const data = AgenticBlackboard.getGlobalData();

    expect(data).toEqual({ logs: [], projects: [] });
    expect(fs.existsSync(path.join(tmpDir, ".global-refiner", "global_history.json"))).toBe(true);
  });
});
