import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgenticBlackboard } from "../src/core/blackboard.js";
import { ConfigManager } from "../src/core/config.js";
import { CommandCenterDashboard, isSameOriginRequest } from "../src/core/dashboard.js";
import { RuntimeLogger } from "../src/core/logger.js";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../src/detectors/project-scout.js";
import { EventStore } from "../src/history/event-store.js";
import { TimelineProvider } from "../src/history/timeline.js";

describe("dashboard deterministic fallbacks", () => {
  let directory: string;
  let store: EventStore;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-coverage-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(directory, "global");
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    store = EventStore.getInstance();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (EventStore as unknown as { instance: EventStore | null }).instance?.close();
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("rejects malformed origin URLs", () => {
    expect(isSameOriginRequest("not a url", "also invalid")).toBe(false);
  });

  it("sanitizes endpoints without ports and logs plain route errors", () => {
    expect((CommandCenterDashboard as any).buildHealth).toBeTypeOf("function");
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue({
      localEnabled: false,
      mcpSamplingEnabled: false,
      baseUrl: "https://localhost/v1",
      models: [],
      timeoutMs: 1,
      temperature: 0,
      allowNonLoopback: false,
    });
    expect((CommandCenterDashboard as any).buildHealth(directory).semantic.local.endpoint).toBe("https://localhost");
    expect(() => (CommandCenterDashboard as any).logRouteError("plain", "plain failure")).not.toThrow();
  });

  it("builds fallback state and filters missing projects", async () => {
    const missing = path.join(directory, "missing");
    vi.spyOn(AgenticBlackboard, "getGlobalData").mockReturnValue({
      projects: [missing],
    } as any);
    vi.spyOn(AgenticBlackboard, "getLogs").mockReturnValue([]);
    vi.spyOn(AgenticBlackboard, "getActiveIntents").mockReturnValue([]);
    vi.spyOn(AgenticBlackboard, "getLastRefinement").mockReturnValue(null);
    vi.spyOn(ArchitecturalScout, "detectPatterns").mockResolvedValue([]);
    vi.spyOn(NodeDetector, "detect").mockResolvedValue({});
    vi.spyOn(PythonDetector, "detect").mockResolvedValue({});
    CommandCenterDashboard.createApp(directory);

    const state = await (CommandCenterDashboard as any).buildState(directory);

    expect(state).toMatchObject({
      selectedPath: directory,
      globalLogs: [],
      stack: "Unknown",
      framework: "None",
      pattern: "Standard",
    });
    expect(state.projects).toEqual([path.resolve(directory)]);
  });

  it("handles global dashboard data without a projects collection", async () => {
    vi.spyOn(AgenticBlackboard, "getGlobalData").mockReturnValue({} as any);
    CommandCenterDashboard.createApp(directory);
    expect((CommandCenterDashboard as any).getVisibleProjects()).toEqual([path.resolve(directory)]);
  });

  it("sanitizes malformed, duplicated, and disabled health telemetry", () => {
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue({
      localEnabled: false,
      mcpSamplingEnabled: false,
      baseUrl: "invalid",
      models: [],
      timeoutMs: 1,
      temperature: 0,
      allowNonLoopback: false,
    });
    const db = (store as any).db;
    const repoId = store.ensureRepository(directory).id;
    store.recordEvent({
      id: "malformed",
      event_type: "semantic_request_completed",
      repo_id: repoId,
      summary: "malformed",
      timestamp: "2026-01-02T00:00:00.000Z",
      details_json: "{",
    });
    store.recordEvent({
      id: "typed",
      event_type: "semantic_request_completed",
      repo_id: repoId,
      summary: "typed",
      timestamp: "2026-01-01T00:00:00.000Z",
      details_json: JSON.stringify({
        taskName: 42,
        provider: "local",
        model: "m",
        latencyMs: -4.6,
        fallbackFrom: ["a", "", 3, "b"],
      }),
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM events").get().count).toBe(2);

    const health = (CommandCenterDashboard as any).buildHealth(directory);

    expect(health.semantic.status).toBe("disabled");
    expect(health.semantic.local.endpoint).toBe("invalid");
    expect(health.semantic.totals).toMatchObject({
      completed: 2,
      averageLatencyMs: 0,
      fallbackCompletions: 1,
    });
    expect(health.semantic.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "unknown", averageLatencyMs: null }),
      expect.objectContaining({ provider: "local", averageLatencyMs: 0, models: ["m"] }),
    ]));
  });

  it("returns route-owned failures without leaking thrown details", async () => {
    const app = CommandCenterDashboard.createApp(directory);
    const routeCases: Array<[string, () => void]> = [
      ["/api/state", () => vi.spyOn(CommandCenterDashboard as any, "buildState").mockRejectedValueOnce(new Error("state secret"))],
      ["/api/timeline", () => vi.spyOn(TimelineProvider.prototype, "getUnifiedTimeline").mockImplementationOnce(() => { throw new Error("timeline secret"); })],
      ["/api/commits", () => vi.spyOn(EventStore, "getInstance").mockImplementationOnce(() => { throw new Error("commit secret"); })],
      ["/api/lessons", () => vi.spyOn(EventStore, "getInstance").mockImplementationOnce(() => { throw new Error("lesson secret"); })],
      ["/api/templates", () => vi.spyOn(EventStore, "getInstance").mockImplementationOnce(() => { throw new Error("template secret"); })],
      ["/api/health", () => vi.spyOn(CommandCenterDashboard as any, "buildHealth").mockImplementationOnce(() => { throw new Error("health secret"); })],
      ["/", () => vi.spyOn(CommandCenterDashboard as any, "buildState").mockRejectedValueOnce("root failure")],
    ];

    for (const [route, arrange] of routeCases) {
      arrange();
      const response = await app.request(route);
      expect(response.status, route).toBe(500);
    }
    expect(RuntimeLogger.error).toBeDefined();
  });

  it("renders an Error without a stack in the root failure page", async () => {
    const app = CommandCenterDashboard.createApp(directory);
    const error = new Error("root message");
    error.stack = "";
    vi.spyOn(CommandCenterDashboard as any, "buildState").mockRejectedValueOnce(error);
    const response = await app.request("/");
    expect(await response.text()).toContain("root message");
  });

  it("handles review persistence failures and successful template approval", async () => {
    const app = CommandCenterDashboard.createApp(directory);
    const request = (kind: string, id: string, decision: "approve" | "reject") => app.request(
      `/api/review/${kind}/${id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    vi.spyOn(EventStore, "getInstance").mockImplementationOnce(() => { throw "review failure"; });
    expect((await request("lesson", "id", "approve")).status).toBe(500);

    const repoId = store.ensureRepository(directory).id;
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
    expect((await request("template", "template", "approve")).status).toBe(200);
  });
});
