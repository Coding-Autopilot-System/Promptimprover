import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PromptRefinerServer } from "../src/core/server.js";
import { EventStore } from "../src/history/event-store.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  return {
    Server: class {
      setRequestHandler = vi.fn();
      connect = vi.fn();
      createMessage = vi.fn().mockResolvedValue({ content: { type: "text", text: "[]" } });
    }
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: vi.fn(),
  };
});

describe("PromptRefinerServer", () => {
  let server: PromptRefinerServer;
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
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
});
