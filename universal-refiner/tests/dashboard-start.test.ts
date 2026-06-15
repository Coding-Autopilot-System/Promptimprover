import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serve: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({ serve: mocks.serve }));
vi.mock("../src/core/logger.js", () => ({
  RuntimeLogger: { error: mocks.error, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { CommandCenterDashboard } from "../src/core/dashboard.js";

describe("dashboard server startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.close.mockImplementation((callback?: () => void) => callback?.());
    mocks.serve.mockReturnValue({ on: mocks.on, close: mocks.close });
  });

  it("binds the configured host and reports server errors", () => {
    process.env.PROMPT_REFINER_DASHBOARD_HOST = "127.0.0.1";
    CommandCenterDashboard.start(3999, ".");
    expect(mocks.serve).toHaveBeenCalledWith(expect.objectContaining({ port: 3999, hostname: "127.0.0.1" }));
    const handler = mocks.on.mock.calls[0][1];
    handler(Object.assign(new Error("busy"), { code: "EADDRINUSE" }));
    handler(Object.assign(new Error("failure"), { code: "EIO" }));
    expect(mocks.error).toHaveBeenCalledTimes(2);
    delete process.env.PROMPT_REFINER_DASHBOARD_HOST;
  });

  it("rethrows synchronous startup failures after logging", () => {
    mocks.serve.mockImplementation(() => {
      throw new Error("startup failed");
    });
    expect(() => CommandCenterDashboard.start(3999, ".")).toThrow("startup failed");
    expect(mocks.error).toHaveBeenCalledWith("Dashboard failed to start on port 3999", expect.any(Error));
  });

  it("closes the active dashboard server and tolerates repeated stops", async () => {
    CommandCenterDashboard.start(3999, ".");
    await CommandCenterDashboard.stop();
    await CommandCenterDashboard.stop();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
