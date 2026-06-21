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

  it("generates collision-resistant prompt IDs for concurrent lint calls", async () => {
    handlers.length = 0;
    new PromptRefinerServer(directory);
    const dispatch = handlers[1] as (request: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

    const [first, second] = await Promise.all([
      dispatch({ params: { name: "lint_prompt", arguments: { prompt: "Implement A", semantic: false } } }),
      dispatch({ params: { name: "lint_prompt", arguments: { prompt: "Implement B", semantic: false } } }),
    ]);
    const firstBody = JSON.parse(first.content[0].text) as { promptId: string };
    const secondBody = JSON.parse(second.content[0].text) as { promptId: string };

    expect(firstBody.promptId).toMatch(/^prm_[0-9a-f-]{36}$/u);
    expect(secondBody.promptId).toMatch(/^prm_[0-9a-f-]{36}$/u);
    expect(firstBody.promptId).not.toBe(secondBody.promptId);
  });

  it("executes every advertised dispatcher path with valid arguments", async () => {
    handlers.length = 0;
    const server = new PromptRefinerServer(directory);
    (server as any).requestModelText = vi.fn(async (taskName: string) => {
      if (taskName === "Rule discovery") return "[]";
      if (taskName.startsWith("Prompt Optimization")) return "---REWRITTEN PROMPT---\nImproved prompt";
      return "model response";
    });
    const list = await handlers[0]({}) as { tools: Array<{ name: string }> };
    const dispatch = handlers[1] as (request: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
    const store = EventStore.getInstance();
    const repoId = (server as any).repository.id;
    store.recordLesson({
      id: "pending-lesson",
      repo_id: repoId,
      lesson_type: "quality",
      title: "Pending lesson",
      summary: "Review me",
      confidence: "high",
      source: "test",
    });
    store.recordTemplate({
      id: "pending-template",
      repo_id: repoId,
      category: "feature",
      title: "Pending template",
      template_text: "Implement and verify.",
      usage_notes: "",
      source_type: "test",
      success_score: 90,
    });

    const args: Record<string, Record<string, unknown>> = {
      lint_prompt: { prompt: "Implement a feature", semantic: false },
      create_questions: { gaps: [{ message: "Missing tests.", suggestedAction: "Add tests." }] },
      finalize_prompt: { original_prompt: "Implement a feature", answers: { scope: "src" } },
      proactive_suggest: { prompt: "Implement a feature" },
      generate_agent_onboarding: {},
      discover_rules: {},
      approve_rule: { id: "missing-rule" },
      list_learning_candidates: {},
      review_lesson: { id: "pending-lesson", approved: true },
      review_template: { id: "pending-template", approved: true },
      ingest_pattern: { id: "pattern", category: "quality", description: "Verify changes." },
      ingest_commits: { limit: 1 },
      derive_lessons: {},
      correlate_history: {},
      optimize_prompt: { prompt: "Implement a feature", iterations: 1 },
      generate_templates: {},
      record_agent_output: { prompt_id: "external-prompt", output_summary: "Completed." },
      evaluate_prompt: { prompt: "Implement src/a.ts and run npm test." },
      compare_prompt_variants: {
        baseline_prompt: "Implement feature",
        variant_a: "Implement feature",
        variant_b: "Implement feature and run tests",
      },
    };

    for (const tool of list.tools) {
      await expect(dispatch({ params: { name: tool.name, arguments: args[tool.name] } }))
        .resolves.toHaveProperty("content");
    }
  });
});
