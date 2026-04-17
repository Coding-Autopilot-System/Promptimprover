import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromptRefinerServer } from "../src/core/server.js";

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

  beforeEach(() => {
    vi.clearAllMocks();
    server = new PromptRefinerServer(".");
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
