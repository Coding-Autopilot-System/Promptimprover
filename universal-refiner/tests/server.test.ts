import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PromptRefinerServer } from "../src/core/server.js";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const lifecycle = vi.hoisted(() => ({
  connect: vi.fn(),
  createMessage: vi.fn(),
  backgroundStart: vi.fn(),
  backgroundStop: vi.fn(),
  backgroundIdle: vi.fn(),
  close: vi.fn(),
}));

// Mock MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  return {
    Server: class {
      setRequestHandler = vi.fn();
      connect = lifecycle.connect;
      createMessage = lifecycle.createMessage;
      close = lifecycle.close;
    }
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: vi.fn(),
  };
});
vi.mock("../src/core/background-service.js", () => ({
  BackgroundAutonomyService: class {
    start = lifecycle.backgroundStart;
    stop = lifecycle.backgroundStop;
    idle = lifecycle.backgroundIdle;
  },
}));

describe("PromptRefinerServer", () => {
  let server: PromptRefinerServer;
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    lifecycle.connect.mockResolvedValue(undefined);
    lifecycle.close.mockResolvedValue(undefined);
    lifecycle.backgroundIdle.mockResolvedValue(undefined);
    lifecycle.createMessage.mockResolvedValue({ content: { type: "text", text: "[]" } });
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-test-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = testDir;
    (EventStore as any).instance = null;
    server = new PromptRefinerServer(".");
  });

  afterEach(() => {
    EventStore.getInstance().close();
    (EventStore as any).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should initialize with correct tools", () => {
    // Access private property for testing if needed, or check setRequestHandler calls
    const mockServerInstance = (server as any).server;
    expect(mockServerInstance.setRequestHandler).toHaveBeenCalled();
  });

  it("should register handlers for all expected tools", () => {
    const mockServerInstance = (server as any).server;
    const registeredHandlers = mockServerInstance.setRequestHandler.mock.calls.map((call: any) => call[0].name);
    
    // Check for some of the ListTools schema or specific tool names if we could
    // Since we mock the schema, we can check how many times it was called
    expect(mockServerInstance.setRequestHandler).toHaveBeenCalledTimes(2); // One for ListTools, one for CallTool
  });

  it("connects transport and starts background autonomy only when requested", async () => {
    await server.run();
    expect(lifecycle.connect).toHaveBeenCalledOnce();
    expect(lifecycle.backgroundStart).not.toHaveBeenCalled();

    await server.stop();
    await server.stop();
    expect(lifecycle.close).toHaveBeenCalledOnce();

    const background = new PromptRefinerServer(".");
    await background.run({ background: true });
    expect(lifecycle.backgroundStart).toHaveBeenCalledOnce();
    await background.stop();
    expect(lifecycle.backgroundStop).toHaveBeenCalledOnce();
    expect(lifecycle.backgroundIdle).toHaveBeenCalledOnce();

    const closing = new PromptRefinerServer(".");
    await closing.run();
    lifecycle.close.mockRejectedValueOnce(new Error("close failed"));
    await expect(closing.stop()).resolves.toBeUndefined();
  });

  it("handles MCP sampling text, non-text, unsupported, and transient failures", async () => {
    lifecycle.createMessage
      .mockResolvedValueOnce({ content: { type: "text", text: "sampled" } })
      .mockResolvedValueOnce({ content: { type: "image", data: "x", mimeType: "image/png" } })
      .mockRejectedValueOnce(new Error("Method not found"))
      .mockRejectedValueOnce(new Error("transient"));

    await expect((server as any).requestMcpSamplingText("prompt", 20)).resolves.toBe("sampled");
    await expect((server as any).requestMcpSamplingText("prompt", 20)).resolves.toBeNull();
    await expect((server as any).requestMcpSamplingText("prompt", 20)).resolves.toBeNull();
    expect(lifecycle.createMessage).toHaveBeenCalledTimes(3);
    await expect((server as any).requestMcpSamplingText("prompt", 20)).resolves.toBeNull();
    expect(lifecycle.createMessage).toHaveBeenCalledTimes(3);

    const transientServer = new PromptRefinerServer(".");
    await expect((transientServer as any).requestMcpSamplingText("prompt", 20)).resolves.toBeNull();
  });

  it("records semantic success telemetry and resolves agent names", () => {
    (server as any).recordSemanticSuccess({
      text: "ok",
      provider: "local",
      model: "gemma",
      latencyMs: 10,
      promptTokens: 4,
      completionTokens: 2,
    }, { taskName: "test" });
    const db = (EventStore.getInstance() as any).db;
    expect(db.prepare("SELECT * FROM events WHERE event_type = ?").get("semantic_request_completed")).toBeDefined();
    expect((server as any).getAgentName({ params: { _meta: { agentName: "agent" } } })).toBe("agent");
    expect((server as any).getAgentName({ params: {} })).toBe("User CLI");
  });
});
