import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watcher: { on: vi.fn(), start: vi.fn(), stop: vi.fn() },
  ingest: vi.fn(),
  correlate: vi.fn(),
  extract: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  dashboard: vi.fn(),
  getObsidianConfig: vi.fn(),
  syncToWiki: vi.fn(),
  getApprovedLessonsWithExecutions: vi.fn(),
  healAndRetry: vi.fn(),
  poller: { on: vi.fn(), start: vi.fn(), stop: vi.fn() },
  pollerConstructor: vi.fn(),
}));

vi.mock("../src/watcher/file-watcher.js", () => ({ FileWatcher: class { constructor() { return mocks.watcher; } } }));
vi.mock("../src/history/commit-ingest.js", () => ({ CommitIngester: { ingestLatest: mocks.ingest } }));
vi.mock("../src/history/correlation-engine.js", () => ({ CorrelationEngine: class { correlateAll = mocks.correlate; } }));
vi.mock("../src/history/lesson-extractor.js", () => ({ LessonExtractor: class { extractNewLessons = mocks.extract; extractFailureLessons = mocks.extract; } }));
vi.mock("../src/core/logger.js", () => ({ RuntimeLogger: { info: mocks.info, debug: mocks.debug, error: mocks.error } }));
vi.mock("../src/core/dashboard.js", () => ({ CommandCenterDashboard: { log: mocks.dashboard } }));
vi.mock("../src/core/config.js", () => ({ ConfigManager: { getObsidianConfig: mocks.getObsidianConfig } }));
vi.mock("../src/history/event-store.js", () => ({
  EventStore: {
    getInstance: () => ({
      getApprovedLessonsWithExecutions: mocks.getApprovedLessonsWithExecutions,
      getLatestPrompts: vi.fn().mockReturnValue([])
    }),
  },
}));
vi.mock("../src/core/execution-orchestrator.js", () => ({
  ExecutionOrchestrator: class {
    healAndRetry = mocks.healAndRetry;
  },
}));
vi.mock("../src/integrations/obsidian/obsidian-orchestrator.js", () => ({
  ObsidianOrchestrator: { syncToWiki: mocks.syncToWiki },
}));
vi.mock("../src/history/git-poller.js", () => ({
  GitPoller: class {
    constructor(rootPath: string, interval: number) {
      mocks.pollerConstructor(rootPath, interval);
    }
    on = mocks.poller.on;
    start = mocks.poller.start;
    stop = mocks.poller.stop;
  },
}));

import { BackgroundAutonomyService } from "../src/core/background-service.js";
import { AutoPilotStatus } from "../src/core/autopilot-status.js";

describe("BackgroundAutonomyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.watcher.on.mockReturnValue(mocks.watcher);
    mocks.watcher.start.mockResolvedValue(undefined);
    mocks.watcher.stop.mockResolvedValue(undefined);
    mocks.ingest.mockResolvedValue(2);
    mocks.correlate.mockResolvedValue(undefined);
    mocks.extract.mockResolvedValue(undefined);
    mocks.getObsidianConfig.mockReturnValue(null);
    mocks.getApprovedLessonsWithExecutions.mockReturnValue([]);
    mocks.healAndRetry.mockResolvedValue(true);
    mocks.syncToWiki.mockResolvedValue(undefined);
    AutoPilotStatus.reset();
  });

  it("starts once, runs the initial serialized cycle, and stops the watcher", async () => {
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    service.start();
    await service.idle();
    service.stop();

    expect(mocks.watcher.start).toHaveBeenCalledTimes(1);
    expect(mocks.ingest).toHaveBeenCalledWith("C:/repo", 100);
    expect(mocks.correlate).toHaveBeenCalledOnce();
    expect(mocks.extract).toHaveBeenCalledTimes(2);
    expect(mocks.watcher.stop).toHaveBeenCalledOnce();
  });

  it("reports watcher degradation without throwing an unhandled error", () => {
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    const errorHandler = mocks.watcher.on.mock.calls.find(call => call[0] === "error")?.[1];

    expect(() => errorHandler(new Error("watch failed"))).not.toThrow();
    expect(mocks.error).toHaveBeenCalledWith("Background autonomy watcher failed", expect.any(Error));
  });

  it("completes a cycle when no commits or lessons are discovered", async () => {
    mocks.ingest.mockResolvedValue(0);
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());

    service.start();
    await service.idle();
    service.stop();

    expect(mocks.dashboard).toHaveBeenCalledWith("Background Autonomy: Ingested 0 commits.");
    expect(AutoPilotStatus.getSnapshot().stats.commitsIngested).toBe(0);
  });

  it("records extracted lesson activity when extraction increments the counter", async () => {
    mocks.extract.mockImplementation(async () => {
      AutoPilotStatus.addLessons(2);
    });
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());

    service.start();
    await service.idle();
    service.stop();

    expect(AutoPilotStatus.getSnapshot().activity.some(activity => activity.kind === "lesson")).toBe(true);
  });

  it("debounces file changes and logs cycle failures for queue retries", async () => {
    vi.useFakeTimers();
    mocks.correlate.mockRejectedValue(new Error("correlation failed"));
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    const changeHandler = mocks.watcher.on.mock.calls.find(call => call[0] === "change")?.[1];
    changeHandler({ event: "change", path: "src/a.ts" });
    changeHandler({ event: "change", path: "src/b.ts" });
    await vi.runAllTimersAsync();
    await service.idle();
    service.stop();
    vi.useRealTimers();

    expect(mocks.debug).toHaveBeenCalledWith(expect.stringContaining("src/b.ts"));
    expect(mocks.error).toHaveBeenCalledWith("Background Autonomy cycle failed", expect.any(Error));
  });

  it("records non-Error cycle failures", async () => {
    mocks.correlate.mockRejectedValue("correlation failed");
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());

    service.start();
    await service.idle();
    service.stop();

    expect(AutoPilotStatus.getSnapshot().activity.some(activity => activity.message === "Cycle failed: correlation failed")).toBe(true);
  });

  it("starts and stops git polling and reacts to discovered commits", async () => {
    vi.useFakeTimers();
    const service = new BackgroundAutonomyService("C:/repo", vi.fn(), 25);
    service.start();
    await service.idle();

    const commitHandler = mocks.poller.on.mock.calls.find(call => call[0] === "commits")?.[1];
    commitHandler();
    await vi.advanceTimersByTimeAsync(3000);
    await service.idle();
    service.stop();
    vi.useRealTimers();

    expect(mocks.pollerConstructor).toHaveBeenCalledWith("C:/repo", 25);
    expect(mocks.poller.start).toHaveBeenCalledOnce();
    expect(mocks.poller.stop).toHaveBeenCalledOnce();
    expect(mocks.ingest).toHaveBeenCalledTimes(2);
  });

  it("coalesces a triggered cycle while the initial cycle is pending", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    mocks.ingest.mockReturnValue(new Promise<number>(resolve => {
      release = () => resolve(1);
    }));
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    const changeHandler = mocks.watcher.on.mock.calls.find(call => call[0] === "change")?.[1];
    changeHandler({ event: "change", path: "src/a.ts" });
    await vi.advanceTimersByTimeAsync(3000);

    expect(mocks.debug).toHaveBeenCalledWith("Background autonomy cycle coalesced", { rootPath: "C:/repo" });
    release();
    await service.idle();
    service.stop();
    service.stop();
    vi.useRealTimers();
  });

  it("syncs to obsidian vault on cycle complete", async () => {
    mocks.getObsidianConfig.mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    await service.idle();
    service.stop();
    expect(mocks.syncToWiki).toHaveBeenCalledWith("C:/repo");
    expect(mocks.dashboard).toHaveBeenCalledWith("Background Autonomy: Synced to Obsidian Vault.");
  });

  it("handles obsidian sync errors", async () => {
    mocks.getObsidianConfig.mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
    mocks.syncToWiki.mockRejectedValue(new Error("sync error"));
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    await service.idle();
    service.stop();
    expect(mocks.dashboard).toHaveBeenCalledWith("Background Autonomy: Failed to sync to Obsidian Vault.");
  });

  it("runs approved failure self-healing lessons during the busy cycle", async () => {
    mocks.getApprovedLessonsWithExecutions.mockReturnValue([{ id: "lesson-1", execution_id: "exec-1" }]);
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());

    service.start();
    await service.idle();
    service.stop();

    expect(mocks.healAndRetry).toHaveBeenCalledWith("exec-1", "lesson-1");
  });

  it("logs self-healing lookup failures without failing the autonomy cycle", async () => {
    mocks.getApprovedLessonsWithExecutions.mockImplementation(() => {
      throw new Error("lesson query failed");
    });
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());

    service.start();
    await service.idle();
    service.stop();

    expect(mocks.error).toHaveBeenCalledWith("Self-healing failed", expect.any(Error));
  });
});
