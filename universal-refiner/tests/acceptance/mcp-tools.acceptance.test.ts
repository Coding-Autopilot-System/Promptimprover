import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptRefinerServer } from "../../src/core/server.js";
import { EventStore } from "../../src/history/event-store.js";

const handlers: Array<(request: unknown) => unknown> = [];
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class {
    setRequestHandler = vi.fn((_schema, handler) => handlers.push(handler));
    connect = vi.fn();
    createMessage = vi.fn();
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: vi.fn() }));

describe("MCP all-tool acceptance", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mcp-tools-acceptance-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = directory;
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
  });

  afterEach(() => {
    const holder = EventStore as unknown as { instance: EventStore | null };
    holder.instance?.close();
    holder.instance = null;
    rmSync(directory, { recursive: true, force: true });
  });

  it("advertises valid schemas and implements a dispatcher case for every tool", async () => {
    handlers.length = 0;
    new PromptRefinerServer(".");
    const listResponse = await handlers[0]({}) as {
      tools: Array<{ name: string; description: string; inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] } }>;
    };
    const source = readFileSync(new URL("../../src/core/server.ts", import.meta.url), "utf8");
    const names = listResponse.tools.map(tool => tool.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(19);
    for (const tool of listResponse.tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(source).toContain(`case "${tool.name}"`);
      for (const required of tool.inputSchema.required ?? []) {
        expect(tool.inputSchema.properties).toHaveProperty(required);
      }
    }
  });

  it("dispatches deterministic evaluation and A/B comparison tools", async () => {
    handlers.length = 0;
    new PromptRefinerServer(".");
    const dispatch = handlers[1] as (request: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

    const evaluation = await dispatch({
      params: {
        name: "evaluate_prompt",
        arguments: { prompt: "Implement src/auth.ts and run npm test." },
      },
    });
    expect(JSON.parse(evaluation.content[0].text)).toMatchObject({ maximumScore: 100 });

    const comparison = await dispatch({
      params: {
        name: "compare_prompt_variants",
        arguments: {
          baseline_prompt: "Fix login",
          variant_a: "Fix login",
          variant_b: "Fix login in src/auth.ts and run npm test.",
          outcome_a: { status: "failed", testsFailed: 1 },
          outcome_b: { status: "completed", testsPassed: 4 },
        },
      },
    });
    expect(JSON.parse(comparison.content[0].text)).toMatchObject({
      observedWinner: "B",
      interpretation: "observed-evidence",
    });
  });
});
