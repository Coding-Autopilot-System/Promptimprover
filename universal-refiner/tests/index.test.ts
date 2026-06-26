import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  let sigintListeners: NodeJS.SignalsListener[];
  let sigtermListeners: NodeJS.SignalsListener[];
  let stdinEndListeners: Array<(...args: unknown[]) => void>;

  beforeEach(() => {
    sigintListeners = process.listeners("SIGINT") as NodeJS.SignalsListener[];
    sigtermListeners = process.listeners("SIGTERM") as NodeJS.SignalsListener[];
    stdinEndListeners = process.stdin.listeners("end") as Array<(...args: unknown[]) => void>;
    vi.resetModules();
    vi.clearAllMocks();
    mocks.serverRun.mockResolvedValue(undefined);
    mocks.serverStop.mockResolvedValue(undefined);
    mocks.watcherStop.mockResolvedValue(undefined);
    mocks.dashboardStop.mockResolvedValue(undefined);
    mocks.flush.mockResolvedValue(undefined);
    delete process.env.PORT;
    delete process.env.PROMPT_REFINER_DASHBOARD_PORT;
    delete process.env.PROMPT_REFINER_BACKGROUND;
  });

  afterEach(() => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.stdin.removeAllListeners("end");
    for (const listener of sigintListeners) process.on("SIGINT", listener);
    for (const listener of sigtermListeners) process.on("SIGTERM", listener);
    for (const listener of stdinEndListeners) process.stdin.on("end", listener);
    vi.restoreAllMocks();
  });

  it("starts a lightweight MCP server without competing background services", async () => {
    await import("../src/index.js");

    expect(mocks.dashboardStart).not.toHaveBeenCalled();
    expect(mocks.serverConstructor).toHaveBeenCalledWith(process.cwd());
    expect(mocks.watcherConstructor).not.toHaveBeenCalled();
    expect(mocks.serverRun).toHaveBeenCalledWith({ background: false });

    const stdinHandler = process.stdin.listeners("end").at(-1) as () => void;
    stdinHandler();
    stdinHandler();
    await vi.waitFor(() => expect(mocks.serverStop).toHaveBeenCalledOnce());
    expect(mocks.flush).toHaveBeenCalledOnce();
  });

  it("starts background ownership explicitly and exits on fatal server failure", async () => {
    process.env.PROMPT_REFINER_DASHBOARD_PORT = "3000";
    process.env.PORT = "4321";
    process.env.PROMPT_REFINER_BACKGROUND = "true";
    const error = new Error("startup failed");
    mocks.serverRun.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/index.js");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(mocks.dashboardStart).toHaveBeenCalledWith(3000, process.cwd());
    expect(mocks.watcherStart).toHaveBeenCalledOnce();
    const changeHandler = mocks.watcherOn.mock.calls.find(call => call[0] === "change")?.[1];
    changeHandler({ event: "change", path: `${process.cwd()}\\src\\a.ts` });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("[FS] change"));
    expect(mocks.dashboardLog).toHaveBeenCalledWith(expect.stringContaining("[FS] change"));
    expect(consoleError).toHaveBeenCalledWith("[FATAL ERROR]", error);
    expect(mocks.serverStop).toHaveBeenCalledOnce();
  });

  it("ignores stdin end while background ownership is active", async () => {
    process.env.PROMPT_REFINER_BACKGROUND = "true";
    await import("../src/index.js");

    const stdinHandler = process.stdin.listeners("end").at(-1) as () => void;
    stdinHandler();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.serverStop).not.toHaveBeenCalled();
  });

  it("shuts down on process signals", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/index.js");
    const signalHandler = process.listeners("SIGTERM").at(-1) as () => void;
    signalHandler();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(mocks.serverStop).toHaveBeenCalledOnce();
  });
});
