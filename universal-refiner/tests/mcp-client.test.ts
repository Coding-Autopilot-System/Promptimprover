import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
  transport: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mocks.connect;
    request = mocks.request;
    close = mocks.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(options: unknown) {
      mocks.transport(options);
    }
  },
}));
vi.mock("fs", () => ({ existsSync: mocks.existsSync }));

import { callMcpTool, resolveServerPath } from "../hooks/lib/mcp-client.js";

describe("hook MCP client", () => {
  beforeEach(() => {
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.request.mockReset();
    mocks.transport.mockReset();
    mocks.existsSync.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.PROMPTIMPROVER_SERVER_PATH;
    delete process.env.PROMPTIMPROVER_HOOK_TIMEOUT_MS;
  });

  it("calls a tool, returns text, honors timeout, and closes the client", async () => {
    process.env.PROMPTIMPROVER_SERVER_PATH = "./custom-server.js";
    process.env.PROMPTIMPROVER_HOOK_TIMEOUT_MS = "25";
    mocks.request.mockResolvedValue({ content: [{ type: "text", text: "result" }] });

    await expect(callMcpTool("lint_prompt", { prompt: "test" })).resolves.toBe("result");
    expect(mocks.transport).toHaveBeenCalledWith(expect.objectContaining({ args: [resolveServerPath()] }));
    const requestOptions = mocks.request.mock.calls[0][2] as { timeout: number; maxTotalTimeout: number };
    expect(requestOptions.timeout).toBeGreaterThan(0);
    expect(requestOptions.timeout).toBeLessThanOrEqual(25);
    expect(requestOptions.maxTotalTimeout).toBe(requestOptions.timeout);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("throws for missing text and still closes after request failures", async () => {
    mocks.request.mockResolvedValueOnce({ content: [] }).mockRejectedValueOnce(new Error("closed"));

    await expect(callMcpTool("lint_prompt", {})).rejects.toThrow(/no text/);
    await expect(callMcpTool("lint_prompt", {})).rejects.toThrow("closed");
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it("retries one reconnect-safe transport failure with a fresh client", async () => {
    mocks.request
      .mockRejectedValueOnce(Object.assign(new Error("private transport detail"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce({ content: [{ type: "text", text: "recovered" }] });

    await expect(callMcpTool("lint_prompt", {})).resolves.toBe("recovered");
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transport failures or more than once", async () => {
    mocks.request
      .mockRejectedValueOnce(Object.assign(new Error("closed"), { code: -32000 }))
      .mockRejectedValueOnce(Object.assign(new Error("closed again"), { code: -32000 }));

    await expect(callMcpTool("lint_prompt", {})).rejects.toThrow("closed again");
    expect(mocks.request).toHaveBeenCalledTimes(2);

    mocks.request.mockReset().mockRejectedValueOnce(new Error("tool failed"));
    await expect(callMcpTool("lint_prompt", {})).rejects.toThrow("tool failed");
    expect(mocks.request).toHaveBeenCalledOnce();

    mocks.request.mockReset().mockRejectedValueOnce("non-error failure");
    await expect(callMcpTool("lint_prompt", {})).rejects.toBe("non-error failure");
  });

  it("bounds the total connect and request duration", async () => {
    vi.useFakeTimers();
    process.env.PROMPTIMPROVER_HOOK_TIMEOUT_MS = "25";
    mocks.connect.mockImplementation(() => new Promise(() => undefined));

    const result = callMcpTool("lint_prompt", {});
    const assertion = expect(result).rejects.toMatchObject({ code: -32001 });
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("shares one deadline across connection and request", async () => {
    vi.useFakeTimers();
    process.env.PROMPTIMPROVER_HOOK_TIMEOUT_MS = "25";
    mocks.connect.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 15)));
    mocks.request.mockImplementation(() => new Promise(() => undefined));

    const result = callMcpTool("lint_prompt", {});
    const assertion = expect(result).rejects.toMatchObject({ code: -32001 });
    await vi.advanceTimersByTimeAsync(15);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0][2]).toEqual({ timeout: 10, maxTotalTimeout: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await assertion;
    expect(mocks.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("resolves built server candidates and uses the default timeout", async () => {
    mocks.request.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    expect(resolveServerPath()).toMatch(/src[\\/]index\.js$/);
    await callMcpTool("lint_prompt", {});
    const options = mocks.request.mock.calls[0][2] as { timeout: number; maxTotalTimeout: number };
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(15_000);
    expect(options.maxTotalTimeout).toBe(options.timeout);
  });

  it("selects an existing built candidate, rejects invalid timeouts, and tolerates close failures", async () => {
    mocks.existsSync.mockImplementation((candidate: string) => candidate.includes("dist"));
    mocks.request.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    mocks.close.mockRejectedValue(new Error("close failed"));
    process.env.PROMPTIMPROVER_HOOK_TIMEOUT_MS = "-1";

    expect(resolveServerPath()).toMatch(/dist[\\/]src[\\/]index\.js$/);
    await expect(callMcpTool("lint_prompt", {})).resolves.toBe("ok");
    const options = mocks.request.mock.calls[0][2] as { timeout: number; maxTotalTimeout: number };
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(15_000);
    expect(options.maxTotalTimeout).toBe(options.timeout);
  });
});
