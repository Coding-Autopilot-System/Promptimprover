import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dashboardStart: vi.fn(),
  dashboardLog: vi.fn(),
  serverRun: vi.fn(),
  watcherStart: vi.fn(),
  watcherOn: vi.fn(),
  loggerInfo: vi.fn(),
  serverConstructor: vi.fn(),
  watcherConstructor: vi.fn(),
}));

vi.mock("../src/core/dashboard.js", () => ({
  CommandCenterDashboard: { start: mocks.dashboardStart, log: mocks.dashboardLog },
}));
vi.mock("../src/core/server.js", () => ({
  PromptRefinerServer: class {
    constructor(rootPath: string) {
      mocks.serverConstructor(rootPath);
    }
    run = mocks.serverRun;
  },
}));
vi.mock("../src/watcher/index.js", () => ({
  FileWatcher: class {
    constructor(rootPath: string) {
      mocks.watcherConstructor(rootPath);
    }
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
    delete process.env.PORT;
  });

  it("starts dashboard, watcher, and MCP server and forwards file events", async () => {
    await import("../src/index.js");

    expect(mocks.dashboardStart).toHaveBeenCalledOnce();
    expect(mocks.dashboardStart).toHaveBeenCalledWith(3000, process.cwd());
    expect(mocks.serverConstructor).toHaveBeenCalledWith(process.cwd());
    expect(mocks.watcherConstructor).toHaveBeenCalledWith(process.cwd());
    expect(mocks.watcherStart).toHaveBeenCalledOnce();
    expect(mocks.serverRun).toHaveBeenCalledOnce();
    const changeHandler = mocks.watcherOn.mock.calls.find(call => call[0] === "change")?.[1];
    changeHandler({ event: "change", path: `${process.cwd()}\\src\\a.ts` });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("[FS] change"));
    expect(mocks.dashboardLog).toHaveBeenCalledWith(expect.stringContaining("[FS] change"));
  });

  it("uses the configured dashboard port and exits on fatal server failure", async () => {
    process.env.PORT = "4321";
    const error = new Error("startup failed");
    mocks.serverRun.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/index.js");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(mocks.dashboardStart).toHaveBeenCalledWith(4321, process.cwd());
    expect(consoleError).toHaveBeenCalledWith("[FATAL ERROR]", error);
  });
});
