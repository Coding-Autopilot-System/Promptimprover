import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dashboardStart: vi.fn(),
  dashboardStop: vi.fn(),
  dashboardLog: vi.fn(),
  serverRun: vi.fn(),
  serverStop: vi.fn(),
  watcherStart: vi.fn(),
  watcherStop: vi.fn(),
  watcherOn: vi.fn(),
  loggerInfo: vi.fn(),
  serverConstructor: vi.fn(),
  watcherConstructor: vi.fn(),
  flush: vi.fn(),
  eventStoreClose: vi.fn(),
}));

vi.mock("../src/core/dashboard.js", () => ({
  CommandCenterDashboard: { start: mocks.dashboardStart, stop: mocks.dashboardStop, log: mocks.dashboardLog },
}));
vi.mock("../src/core/server.js", () => ({
  PromptRefinerServer: class {
    constructor(rootPath: string) {
      mocks.serverConstructor(rootPath);
    }
    run = mocks.serverRun;
    stop = mocks.serverStop;
  },
}));
vi.mock("../src/watcher/index.js", () => ({
  FileWatcher: class {
    constructor(rootPath: string) {
      mocks.watcherConstructor(rootPath);
    }
    on = mocks.watcherOn;
    start = mocks.watcherStart;
    stop = mocks.watcherStop;
  },
}));
vi.mock("../src/core/logger.js", () => ({ RuntimeLogger: { info: mocks.loggerInfo } }));
vi.mock("../src/core/blackboard.js", () => ({ AgenticBlackboard: { flushPendingWrites: mocks.flush } }));
vi.mock("../src/history/event-store.js", () => ({
  EventStore: { getInstance: () => ({ close: mocks.eventStoreClose }) },
}));

describe("runtime bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.serverRun.mockResolvedValue(undefined);
    mocks.serverStop.mockResolvedValue(undefined);
    mocks.watcherStop.mockResolvedValue(undefined);
    mocks.dashboardStop.mockResolvedValue(undefined);
    mocks.flush.mockResolvedValue(undefined);
    delete process.env.PORT;
    delete process.env.PROMPT_REFINER_BACKGROUND;
  });

  it("starts a lightweight MCP server without competing background services", async () => {
    await import("../src/index.js");

    expect(mocks.dashboardStart).not.toHaveBeenCalled();
    expect(mocks.serverConstructor).toHaveBeenCalledWith(process.cwd());
    expect(mocks.watcherConstructor).not.toHaveBeenCalled();
    expect(mocks.serverRun).toHaveBeenCalledWith({ background: false });
  });

  it("starts background ownership explicitly and exits on fatal server failure", async () => {
    process.env.PORT = "4321";
    process.env.PROMPT_REFINER_BACKGROUND = "true";
    const error = new Error("startup failed");
    mocks.serverRun.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/index.js");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(mocks.dashboardStart).toHaveBeenCalledWith(4321, process.cwd());
    expect(mocks.watcherStart).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith("[FATAL ERROR]", error);
    expect(mocks.serverStop).toHaveBeenCalledOnce();
  });
});
