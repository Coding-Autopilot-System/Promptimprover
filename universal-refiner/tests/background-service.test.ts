import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watcher: { on: vi.fn(), close: vi.fn() },
  watch: vi.fn(),
  ingest: vi.fn(),
  correlate: vi.fn(),
  extract: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  dashboard: vi.fn(),
}));

vi.mock("chokidar", () => ({ watch: mocks.watch }));
vi.mock("../src/history/commit-ingest.js", () => ({ CommitIngester: { ingestLatest: mocks.ingest } }));
vi.mock("../src/history/correlation-engine.js", () => ({ CorrelationEngine: class { correlateAll = mocks.correlate; } }));
vi.mock("../src/history/lesson-extractor.js", () => ({ LessonExtractor: class { extractNewLessons = mocks.extract; } }));
vi.mock("../src/core/logger.js", () => ({ RuntimeLogger: { info: mocks.info, debug: mocks.debug, error: mocks.error } }));
vi.mock("../src/core/dashboard.js", () => ({ CommandCenterDashboard: { log: mocks.dashboard } }));

import { BackgroundAutonomyService } from "../src/core/background-service.js";

describe("BackgroundAutonomyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.watch.mockReturnValue(mocks.watcher);
    mocks.watcher.on.mockReturnValue(mocks.watcher);
    mocks.ingest.mockResolvedValue(2);
    mocks.correlate.mockResolvedValue(undefined);
    mocks.extract.mockResolvedValue(undefined);
  });

  it("starts once, runs the initial serialized cycle, and stops the watcher", async () => {
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    service.start();
    await service.idle();
    service.stop();

    expect(mocks.watch).toHaveBeenCalledTimes(1);
    expect(mocks.ingest).toHaveBeenCalledWith("C:/repo", 100);
    expect(mocks.correlate).toHaveBeenCalledBefore(mocks.extract);
    expect(mocks.watcher.close).toHaveBeenCalledOnce();
  });

  it("debounces file changes and logs cycle failures for queue retries", async () => {
    vi.useFakeTimers();
    mocks.correlate.mockRejectedValue(new Error("correlation failed"));
    const service = new BackgroundAutonomyService("C:/repo", vi.fn());
    service.start();
    const changeHandler = mocks.watcher.on.mock.calls.find(call => call[0] === "all")?.[1];
    changeHandler("change", "src/a.ts");
    changeHandler("change", "src/b.ts");
    await vi.runAllTimersAsync();
    await service.idle();
    service.stop();
    vi.useRealTimers();

    expect(mocks.debug).toHaveBeenCalledWith(expect.stringContaining("src/b.ts"));
    expect(mocks.error).toHaveBeenCalledWith("Background Autonomy cycle failed", expect.any(Error));
  });
});
