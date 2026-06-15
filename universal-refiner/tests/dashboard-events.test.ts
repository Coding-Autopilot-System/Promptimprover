import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const mocks = vi.hoisted(() => ({
  missingHtml: false,
  streamSSE: vi.fn(),
}));

vi.mock("hono/streaming", () => ({
  streamSSE: mocks.streamSSE,
}));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (target: fs.PathLike) => mocks.missingHtml ? false : actual.existsSync(target),
  };
});

import { AgenticBlackboard } from "../src/core/blackboard.js";
import { ConfigManager } from "../src/core/config.js";
import { CommandCenterDashboard } from "../src/core/dashboard.js";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../src/detectors/project-scout.js";
import { EventStore } from "../src/history/event-store.js";

describe("dashboard event stream and render failures", () => {
  let controller: AbortController;
  let directory: string;
  let store: EventStore;

  beforeEach(() => {
    mocks.missingHtml = false;
    controller = new AbortController();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-events-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(directory, "global");
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    store = EventStore.getInstance();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.close();
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("streams ready, update, and ping events, then unsubscribes on abort", async () => {
    const writes: Array<{ event: string; data: string; id: string }> = [];
    const unsubscribe = vi.fn();
    let pushUpdate: (() => void) | undefined;
    vi.spyOn(AgenticBlackboard, "onUpdate").mockImplementation((callback) => {
      pushUpdate = callback;
      return unsubscribe;
    });
    mocks.streamSSE.mockImplementation(async (context, callback) => {
      const stream = {
        writeSSE: vi.fn(async (event) => {
          writes.push(event);
        }),
        sleep: vi.fn(async () => {
          pushUpdate?.();
          controller.abort();
          pushUpdate?.();
        }),
      };
      await callback(stream);
      return context.text("closed");
    });

    const app = CommandCenterDashboard.createApp(directory);
    const response = await app.request("/api/events", { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(writes.map(({ event }) => event)).toEqual(["ready", "update", "ping"]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("forwards dashboard refinement and log updates to the blackboard", async () => {
    const setLastRefinement = vi.spyOn(AgenticBlackboard, "setLastRefinement").mockResolvedValue();
    const postLog = vi.spyOn(AgenticBlackboard, "postLog").mockImplementation(() => undefined);

    await CommandCenterDashboard.setLastRefinement("before", "after", directory, 7);
    CommandCenterDashboard.log("completed", directory);

    expect(setLastRefinement).toHaveBeenCalledWith("before", "after", directory, 7);
    expect(postLog).toHaveBeenCalledWith("completed", directory);
  });

  it("builds state from Python and architectural detector fallbacks", async () => {
    vi.spyOn(AgenticBlackboard, "getGlobalData").mockReturnValue({ projects: [], logs: [] } as any);
    vi.spyOn(AgenticBlackboard, "getLogs").mockReturnValue([]);
    vi.spyOn(AgenticBlackboard, "getActiveIntents").mockReturnValue([]);
    vi.spyOn(AgenticBlackboard, "getLastRefinement").mockReturnValue(null);
    vi.spyOn(ArchitecturalScout, "detectPatterns").mockResolvedValue(["Layered", "Ignored"]);
    vi.spyOn(NodeDetector, "detect").mockResolvedValue({});
    vi.spyOn(PythonDetector, "detect").mockResolvedValue({ language: "Python", framework: "FastAPI" });
    CommandCenterDashboard.createApp(directory);

    const state = await (CommandCenterDashboard as any).buildState(directory);

    expect(state).toMatchObject({
      stack: "Python",
      framework: "FastAPI",
      pattern: "Layered",
    });
  });

  it("builds configured health from duplicate and sanitized provider telemetry", () => {
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue({
      localEnabled: true,
      mcpSamplingEnabled: false,
      baseUrl: "http://localhost:1234/path?secret=value",
      models: ["local"],
      timeoutMs: 10,
      temperature: 0,
      allowNonLoopback: false,
    });
    const repoId = store.ensureRepository(directory).id;
    const longValue = "x".repeat(200);
    store.recordEvent({
      id: "latest",
      event_type: "semantic_request_completed",
      repo_id: repoId,
      summary: "latest",
      timestamp: "2026-06-15T02:00:00.000Z",
      details_json: JSON.stringify({
        taskName: longValue,
        provider: "local",
        model: "",
        latencyMs: Number.POSITIVE_INFINITY,
        fallbackFrom: "not-an-array",
      }),
    });
    store.recordEvent({
      id: "earlier",
      event_type: "semantic_request_completed",
      repo_id: repoId,
      summary: "earlier",
      timestamp: "2026-06-15T01:00:00.000Z",
      details_json: JSON.stringify({
        provider: "local",
        model: "model",
        latencyMs: 9.6,
        fallbackFrom: Array.from({ length: 12 }, (_, index) => `fallback-${index}`),
      }),
    });

    const health = (CommandCenterDashboard as any).buildHealth(directory);

    expect(health.semantic.status).toBe("healthy");
    expect(health.semantic.local.endpoint).toBe("http://localhost:1234");
    expect(health.semantic.lastSuccess).toMatchObject({
      taskName: longValue.slice(0, 120),
      provider: "local",
      model: "unknown",
      latencyMs: null,
      fallbackFrom: [],
    });
    expect(health.semantic.providers).toEqual([
      expect.objectContaining({
        provider: "local",
        completions: 2,
        averageLatencyMs: 10,
        models: ["unknown", "model"],
      }),
    ]);
    expect(health.semantic.totals.averageLatencyMs).toBe(10);
    expect(health.semantic.totals.fallbackCompletions).toBe(1);
  });

  it("reports configured semantic health before the first completion", () => {
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue({
      localEnabled: false,
      mcpSamplingEnabled: true,
      baseUrl: "http://localhost:1234",
      models: [],
      timeoutMs: 10,
      temperature: 0,
      allowNonLoopback: false,
    });

    const health = (CommandCenterDashboard as any).buildHealth(directory);

    expect(health.semantic.status).toBe("configured");
    expect(health.semantic.lastSuccess).toBeNull();
    expect(health.semantic.totals.averageLatencyMs).toBeNull();
    expect(health.semantic.providers).toEqual([]);
  });

  it("returns the route-owned event stream error response", async () => {
    mocks.streamSSE.mockImplementation(() => {
      throw new Error("stream failed");
    });
    const app = CommandCenterDashboard.createApp(directory);

    const response = await app.request("/api/events");

      expect(response.status).toBe(500);
      expect(html).toContain("See sanitized runtime logs");
      expect(html).not.toContain("Could not find dashboard.html");
    expect(await response.text()).toBe("Dashboard event stream unavailable");
  });

  it("renders a route-owned error when dashboard HTML is missing", async () => {
    vi.spyOn(CommandCenterDashboard as any, "buildState").mockResolvedValue({
      selectedPath: directory,
      projects: [directory],
      globalLogs: [],
      logs: [],
      intents: [],
      lastRefinement: null,
      stack: "Unknown",
      framework: "None",
      pattern: "Standard",
    });
    mocks.missingHtml = true;
    const app = CommandCenterDashboard.createApp(directory);

    const response = await app.request("/");
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("Dashboard Error");
    expect(html).toContain("Could not find dashboard.html");
  });
});
