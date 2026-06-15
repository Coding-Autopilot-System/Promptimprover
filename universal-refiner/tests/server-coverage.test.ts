import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AgenticBlackboard } from "../src/core/blackboard.js";
import { ConfigManager } from "../src/core/config.js";
import { PromptRefinerServer } from "../src/core/server.js";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../src/detectors/project-scout.js";
import { EventStore } from "../src/history/event-store.js";
import { PromptLinter } from "../src/linters/prompt-linter.js";
import { LocalBrain } from "../src/memory/local-brain.js";
import { NeuralSnippets } from "../src/memory/neural-snippets.js";

const handlers: Array<(request: any) => any> = [];
const createMessage = vi.fn();

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class {
    setRequestHandler = vi.fn((_schema, handler) => handlers.push(handler));
    connect = vi.fn();
    createMessage = createMessage;
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: vi.fn() }));

describe("PromptRefinerServer deterministic fallbacks", () => {
  let directory: string;
  let server: PromptRefinerServer;
  let dispatch: (request: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.length = 0;
    directory = mkdtempSync(join(tmpdir(), "server-coverage-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = directory;
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    server = new PromptRefinerServer(directory);
    dispatch = handlers[1];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (EventStore as unknown as { instance: EventStore | null }).instance?.close();
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates empty and rejected semantic provider chains", () => {
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue({
      localEnabled: false,
      mcpSamplingEnabled: false,
      baseUrl: "http://localhost:1/v1",
      models: [],
      timeoutMs: 1,
      temperature: 0,
      allowNonLoopback: false,
    });
    expect((server as any).createSemanticProviderChain()).toBeDefined();

    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue({
      localEnabled: true,
      mcpSamplingEnabled: false,
      baseUrl: "https://remote.example/v1",
      models: ["m"],
      timeoutMs: 1,
      temperature: 0,
      allowNonLoopback: false,
    });
    expect((server as any).createSemanticProviderChain()).toBeDefined();
  });

  it("scouts Python and unknown fallbacks with and without snippets", async () => {
    vi.spyOn(NodeDetector, "detect").mockResolvedValue({});
    vi.spyOn(PythonDetector, "detect")
      .mockResolvedValueOnce({ language: "Python", framework: "Flask", testing: "Pytest", orm: "SQLAlchemy", isTypeScript: false })
      .mockResolvedValueOnce({});
    vi.spyOn(ArchitecturalScout, "detectPatterns").mockResolvedValue([]);
    vi.spyOn(LocalBrain, "getPatterns").mockReturnValue([]);
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({});
    vi.spyOn(ConfigManager, "getPredictiveMandates").mockReturnValue([]);
    vi.spyOn(NeuralSnippets, "search").mockResolvedValue([]);
    vi.spyOn(AgenticBlackboard, "getActiveIntents").mockReturnValue([]);

    await expect((server as any).scoutProject("query")).resolves.toMatchObject({
      language: "Python",
      framework: "Flask",
      testing: "Pytest",
      orm: "SQLAlchemy",
      isTypeScript: false,
    });
    await expect((server as any).scoutProject()).resolves.toMatchObject({
      language: "Unknown",
      framework: "Unknown",
      testing: "Unknown",
    });
  });

  it("handles all semantic lint and sampling fallback outcomes", async () => {
    vi.spyOn(server, "requestModelText")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('[{"id":"gap"}]')
      .mockResolvedValueOnce("not json");

    await expect((server as any).lintSemantic("prompt", {})).resolves.toEqual([]);
    await expect((server as any).lintSemantic("prompt", {})).resolves.toEqual([{ id: "gap" }]);
    await expect((server as any).lintSemantic("prompt", {})).resolves.toEqual([]);
    expect((server as any).isSamplingUnsupportedError("-32601 unsupported")).toBe(true);
    expect((server as any).isSamplingUnsupportedError("other")).toBe(false);
    (server as any).disableSampling("first", "plain failure");
    (server as any).disableSampling("second", new Error("ignored"));
    expect((server as any).samplingUnavailableReason).toBe("first");
  });

  it("delegates model requests and dispatches semantic linting by default", async () => {
    const requestText = vi.fn().mockResolvedValue("model response");
    (server as any).semanticProviders = { requestText };

    await expect(server.requestModelText("Task", "Prompt", 321)).resolves.toBe("model response");
    expect(requestText).toHaveBeenCalledWith({ taskName: "Task", prompt: "Prompt", maxTokens: 321 });

    vi.spyOn(server as any, "scoutProject").mockResolvedValue({});
    vi.spyOn(PromptLinter, "lint").mockReturnValue([]);
    vi.spyOn(PromptLinter, "mergeGaps").mockImplementation((_ruleGaps, semanticGaps) => semanticGaps);
    const semanticLint = vi.spyOn(server as any, "lintSemantic").mockResolvedValue([{ id: "semantic-gap" }]);

    const result = await dispatch({ params: { name: "lint_prompt", arguments: { prompt: "Analyze this" } } });

    expect(semanticLint).toHaveBeenCalledWith("Analyze this", {});
    expect(JSON.parse(result.content[0].text).gaps).toEqual([{ id: "semantic-gap" }]);
  });

  it("persists valid discovery proposals for review", async () => {
    vi.spyOn(server as any, "scoutProject").mockResolvedValue({});
    vi.spyOn(server, "requestModelText").mockResolvedValue(
      '[{"id":"strict-types","category":"quality","description":"Require strict types."}]',
    );
    const savePattern = vi.spyOn(LocalBrain, "savePattern");

    await expect(dispatch({ params: { name: "discover_rules", arguments: {} } }))
      .resolves.toHaveProperty("content.0.text", "Successfully discovered and proposed 1 new rules.");
    expect(savePattern).toHaveBeenCalledWith({
      id: "strict-types",
      category: "quality",
      description: "Require strict types.",
      isProposed: true,
    }, directory);
  });

  it("covers dispatcher fallback responses and preserved protocol errors", async () => {
    vi.spyOn(server, "requestModelText").mockResolvedValue(null);
    await expect(dispatch({ params: { name: "discover_rules", arguments: {} } }))
      .resolves.toHaveProperty("content.0.text", "Discovery unavailable because MCP sampling is not supported by the current client/runtime.");
    await expect(dispatch({ params: { name: "proactive_suggest", arguments: { prompt: "x" } } }))
      .resolves.toHaveProperty("content.0.text", expect.stringContaining("unavailable"));
    await expect(dispatch({ params: { name: "generate_agent_onboarding", arguments: {} } }))
      .resolves.toHaveProperty("content.0.text", expect.stringContaining("unavailable"));
    await expect(dispatch({ params: { name: "unknown", arguments: {} } })).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    await expect(dispatch({ params: { name: "lint_prompt", arguments: {} } })).rejects.toMatchObject({ code: ErrorCode.InternalError });
    await expect(dispatch({ params: { name: "review_lesson", arguments: { id: "missing", approved: false } } }))
      .rejects.toBeInstanceOf(McpError);
    await expect(dispatch({ params: { name: "review_template", arguments: { id: "missing", approved: false } } }))
      .rejects.toBeInstanceOf(McpError);
  });

  it("covers discovery parse failure, default options, rejection, and execution update", async () => {
    vi.spyOn(server, "requestModelText").mockResolvedValueOnce("invalid");
    await expect(dispatch({ params: { name: "discover_rules", arguments: {} } }))
      .resolves.toHaveProperty("content.0.text", "Discovery failed to parse.");

    const store = EventStore.getInstance();
    const repoId = (server as any).repository.id;
    store.recordLesson({
      id: "lesson",
      repo_id: repoId,
      lesson_type: "quality",
      title: "Lesson",
      summary: "Summary",
      confidence: "high",
      source: "test",
    });
    store.recordTemplate({
      id: "template",
      repo_id: repoId,
      category: "quality",
      title: "Template",
      template_text: "Verify.",
      usage_notes: "",
      source_type: "test",
      success_score: 1,
    });
    await expect(dispatch({ params: { name: "review_lesson", arguments: { id: "lesson", approved: false } } })).resolves.toBeDefined();
    await expect(dispatch({ params: { name: "review_template", arguments: { id: "template", approved: false } } })).resolves.toBeDefined();
    await expect(dispatch({ params: { name: "ingest_commits", arguments: {} } })).resolves.toBeDefined();
    vi.spyOn(server, "requestModelText").mockResolvedValue("no rewrite marker");
    await expect(dispatch({ params: { name: "optimize_prompt", arguments: { prompt: "work", iterations: 0 } } }))
      .resolves.toBeDefined();

    store.recordPrompt({ id: "prompt", repo_id: repoId, client: "test", raw_prompt: "work" });
    store.recordExecution({
      id: "execution",
      prompt_id: "prompt",
      workflow_name: "test",
      executor_name: "test",
      status: "running",
      artifacts_json: '{"existing":true}',
    });
    await expect(dispatch({
      params: {
        name: "record_agent_output",
        _meta: { progressToken: "agent-token" },
        arguments: { prompt_id: "prompt", output_summary: "done" },
      },
    })).resolves.toBeDefined();
    await expect(dispatch({
      params: {
        name: "evaluate_prompt",
        arguments: { prompt: "Do work and test.", baseline_prompt: "Do work." },
      },
    })).resolves.toBeDefined();
  });
});
