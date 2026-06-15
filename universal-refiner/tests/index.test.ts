import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dashboardStart: vi.fn(),
  dashboardLog: vi.fn(),
  serverRun: vi.fn(),
  watcherStart: vi.fn(),
  watcherOn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("../src/core/dashboard.js", () => ({
  CommandCenterDashboard: { start: mocks.dashboardStart, log: mocks.dashboardLog },
}));
vi.mock("../src/core/server.js", () => ({
  PromptRefinerServer: class {
    run = mocks.serverRun;
  },
}));
vi.mock("../src/watcher/index.js", () => ({
  FileWatcher: class {
    on = mocks.watcherOn;
    start = mocks.watcherStart;
  },
}));
vi.mock("../src/core/logger.js", () => ({ RuntimeLogger: { info: mocks.loggerInfo } }));

describe("runtime bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.serverRun.mockResolvedValue(undefined);
  });

  it("starts dashboard, watcher, and MCP server and forwards file events", async () => {
    await import("../src/index.js");

    expect(mocks.dashboardStart).toHaveBeenCalledOnce();
    expect(mocks.watcherStart).toHaveBeenCalledOnce();
    expect(mocks.serverRun).toHaveBeenCalledOnce();
    const changeHandler = mocks.watcherOn.mock.calls.find(call => call[0] === "change")?.[1];
    changeHandler({ event: "change", path: `${process.cwd()}\\src\\a.ts` });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("[FS] change"));
    expect(mocks.dashboardLog).toHaveBeenCalledWith(expect.stringContaining("[FS] change"));
  });
});
