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
    mocks.close.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue(undefined);
    mocks.existsSync.mockReturnValue(false);
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
    expect(mocks.request.mock.calls[0][2]).toEqual({ timeout: 25 });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("throws for missing text and still closes after request failures", async () => {
    mocks.request.mockResolvedValueOnce({ content: [] }).mockRejectedValueOnce(new Error("closed"));

    await expect(callMcpTool("lint_prompt", {})).rejects.toThrow(/no text/);
    await expect(callMcpTool("lint_prompt", {})).rejects.toThrow("closed");
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it("resolves built server candidates and uses the default timeout", async () => {
    mocks.request.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    expect(resolveServerPath()).toMatch(/src[\\/]index\.js$/);
    await callMcpTool("lint_prompt", {});
    expect(mocks.request.mock.calls[0][2]).toEqual({ timeout: 15_000 });
  });
});
