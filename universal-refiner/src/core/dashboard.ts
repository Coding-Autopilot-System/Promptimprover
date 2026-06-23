import { Hono } from "hono";
import * as fs from "fs";
import { serve } from "@hono/node-server";
import { AgenticBlackboard, BlackboardData, SystemLog, AgentIntent } from "./blackboard.js";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../detectors/project-scout.js";
import * as path from "path";
import { fileURLToPath } from "url";
import { streamSSE } from "hono/streaming";
import { getDisplayVersion } from "./version.js";
import { RuntimeLogger } from "./logger.js";
import { ConfigManager } from "./config.js";

import { TimelineProvider } from "../history/timeline.js";
import { EventStore } from "../history/event-store.js";
import { AutoPilotStatus } from "./autopilot-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveDashboardHost(configuredHost = process.env.PROMPT_REFINER_DASHBOARD_HOST): string {
  const host = configuredHost?.trim() || "127.0.0.1";
  if (isLoopbackHost(host) || process.env.PROMPT_REFINER_DASHBOARD_ALLOW_REMOTE === "true") {
    return host;
  }
  RuntimeLogger.warn("Ignoring non-loopback dashboard host without PROMPT_REFINER_DASHBOARD_ALLOW_REMOTE=true", { host });
  return "127.0.0.1";
}

interface DashboardState {
  selectedPath: string;
  projects: string[];
  globalLogs: SystemLog[];
  logs: SystemLog[];
  intents: AgentIntent[];
  lastRefinement: BlackboardData["lastRefinement"] | null;
  stack: string;
  framework: string;
  pattern: string;
}

interface SemanticEventDetails {
  taskName?: unknown;
  provider?: unknown;
  model?: unknown;
  latencyMs?: unknown;
  fallbackFrom?: unknown;
}

interface SemanticEventRow {
  timestamp: string;
  details_json: string;
}

function safeString(value: unknown, maxLength = 120): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : null;
}

function sanitizeEndpoint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "invalid";
  }
}

export function isSameOriginRequest(origin: string | undefined, requestUrl: string): boolean {
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export function isJsonContentType(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function redactSensitive(value: string): string {
  return value
    .replace(/(ghp_|github_pat_|sk-|xox[baprs]-)[a-z0-9_\-]+/gi, "$1[REDACTED]")
    .replace(/(token|api[_-]?key|password|secret|authorization)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 2_000);
}

export class CommandCenterDashboard {
  private static rootPath: string = ".";
  private static server: { close: (callback?: (error?: Error) => void) => void } | null = null;

  static async setLastRefinement(original: string, refined: string, projectPath: string = ".", gain: number = 0) {
    await AgenticBlackboard.setLastRefinement(original, refined, projectPath, gain);
  }

  static log(message: string, projectPath: string = ".") {
    AgenticBlackboard.postLog(message, projectPath);
  }

  private static getVisibleProjects(): string[] {
    const globalData = AgenticBlackboard.getGlobalData();
    const uniqueProjects = new Set<string>([
      path.resolve(this.rootPath),
      ...(globalData.projects || []).map(projectPath => path.resolve(projectPath))
    ]);
    return [...uniqueProjects].filter(projectPath => fs.existsSync(projectPath));
  }

  private static logRouteError(routeName: string, error: unknown, selectedPath?: string) {
    const message = redactSensitive(error instanceof Error ? error.stack || error.message : String(error));
    RuntimeLogger.error(`Dashboard route failed: ${routeName}`, {
      selectedPath: selectedPath || this.rootPath,
      error: message,
    });
    console.error(`[Dashboard:${routeName}]`, message);
    AgenticBlackboard.postLog(`Dashboard ${routeName} error: ${message.split("\n")[0]}`, selectedPath || this.rootPath);
  }

  private static resolveSelectedPath(projectParam?: string | null): string {
    const projects = new Set<string>(this.getVisibleProjects());
    const requestedPath = projectParam ? path.resolve(projectParam) : path.resolve(this.rootPath);
    if (projects.has(requestedPath)) {
      return requestedPath;
    }
    return path.resolve(this.rootPath);
  }

  private static async buildState(selectedPath: string): Promise<DashboardState> {
    const globalData = AgenticBlackboard.getGlobalData();
    const visibleProjects = this.getVisibleProjects();
    const arch = await ArchitecturalScout.detectPatterns(selectedPath);
    const node = await NodeDetector.detect(selectedPath);
    const py = await PythonDetector.detect(selectedPath);
    return {
      selectedPath,
      projects: visibleProjects,
      globalLogs: globalData.logs || [],
      logs: AgenticBlackboard.getLogs(selectedPath),
      intents: AgenticBlackboard.getActiveIntents(selectedPath),
      lastRefinement: AgenticBlackboard.getLastRefinement(selectedPath),
      stack: node.language || py.language || "Unknown",
      framework: node.framework || py.framework || "None",
      pattern: arch.length > 0 ? arch.slice(0, 1).join(", ") : "Standard"
    };
  }

  private static buildHealth(selectedPath: string) {
    const repoId = EventStore.getInstance().ensureRepository(selectedPath).id;
    const config = ConfigManager.getSemanticConfig(selectedPath);
    const db = (EventStore.getInstance() as any).db;
    const rows = db.prepare(`
      SELECT timestamp, details_json
      FROM events
      WHERE repo_id = ? AND event_type = 'semantic_request_completed'
      ORDER BY timestamp DESC
      LIMIT 100
    `).all(repoId) as SemanticEventRow[];

    const events = rows.map(row => {
      let details: SemanticEventDetails = {};
      try {
        details = JSON.parse(row.details_json) as SemanticEventDetails;
      } catch {
        // Malformed historical telemetry is ignored rather than exposed.
      }
      return {
        timestamp: row.timestamp,
        taskName: safeString(details.taskName),
        provider: safeString(details.provider) || "unknown",
        model: safeString(details.model) || "unknown",
        latencyMs: typeof details.latencyMs === "number" && Number.isFinite(details.latencyMs)
          ? Math.max(0, Math.round(details.latencyMs))
          : null,
        fallbackFrom: Array.isArray(details.fallbackFrom)
          ? details.fallbackFrom.map(item => safeString(item, 80)).filter((item): item is string => item !== null).slice(0, 10)
          : [],
      };
    });

    const providerMetrics = new Map<string, {
      completions: number;
      latencyTotal: number;
      latencyCount: number;
      lastSuccessAt: string;
      models: Set<string>;
    }>();
    for (const event of events) {
      const metric = providerMetrics.get(event.provider) || {
        completions: 0,
        latencyTotal: 0,
        latencyCount: 0,
        lastSuccessAt: event.timestamp,
        models: new Set<string>(),
      };
      metric.completions += 1;
      if (event.latencyMs !== null) {
        metric.latencyTotal += event.latencyMs;
        metric.latencyCount += 1;
      }
      metric.models.add(event.model);
      providerMetrics.set(event.provider, metric);
    }

    const totalLatency = events.reduce((sum, event) => sum + (event.latencyMs || 0), 0);
    const latencyCount = events.filter(event => event.latencyMs !== null).length;
    const semanticEnabled = config.localEnabled || config.mcpSamplingEnabled;

    return {
      runtime: {
        status: "online",
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        checkedAt: new Date().toISOString(),
      },
      semantic: {
        status: !semanticEnabled ? "disabled" : events.length > 0 ? "healthy" : "configured",
        local: {
          enabled: config.localEnabled,
          endpoint: sanitizeEndpoint(config.baseUrl),
          models: config.models,
          timeoutMs: config.timeoutMs,
          allowNonLoopback: config.allowNonLoopback,
        },
        mcpSampling: { enabled: config.mcpSamplingEnabled },
        totals: {
          completed: events.length,
          averageLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null,
          fallbackCompletions: events.filter(event => event.fallbackFrom.length > 0).length,
        },
        lastSuccess: events[0] || null,
        providers: [...providerMetrics.entries()].map(([provider, metric]) => ({
          provider,
          completions: metric.completions,
          averageLatencyMs: metric.latencyCount > 0 ? Math.round(metric.latencyTotal / metric.latencyCount) : null,
          lastSuccessAt: metric.lastSuccessAt,
          models: [...metric.models],
        })),
      },
    };
  }

  static createApp(defaultPath = ".") {
    this.rootPath = defaultPath;
    const app = new Hono();

    app.get("/api/state", async (c) => {
      const selectedPath = this.resolveSelectedPath(c.req.query("project"));
      try {
        const state = await this.buildState(selectedPath);
        return c.json(state);
      } catch (error) {
        this.logRouteError("api/state", error, selectedPath);
        return c.json({ error: "Dashboard state unavailable", selectedPath }, 500);
      }
    });

    app.get("/api/timeline", async (c) => {
      try {
        const store = EventStore.getInstance();
        const repoId = store.ensureRepository(this.resolveSelectedPath(c.req.query("project"))).id;
        const provider = new TimelineProvider();
        const timeline = provider.getUnifiedTimeline(50, repoId);
        return c.json(timeline);
      } catch (error) {
        this.logRouteError("api/timeline", error);
        return c.json({ error: "Timeline unavailable" }, 500);
      }
    });

    app.get("/api/commits", async (c) => {
      try {
        const store = EventStore.getInstance();
        const repoId = store.ensureRepository(this.resolveSelectedPath(c.req.query("project"))).id;
        const db = (store as any).db;
        const commits = db.prepare(`
          SELECT c.*, e.prompt_id, e.id as execution_id
          FROM commits c
          LEFT JOIN execution_commits ec ON c.id = ec.commit_id
          LEFT JOIN executions e ON ec.execution_id = e.id
          WHERE c.repo_id = ?
          ORDER BY c.committed_at DESC LIMIT 50
        `).all(repoId);
        return c.json(commits);
      } catch (error) {
        this.logRouteError("api/commits", error);
        return c.json({ error: "Commits unavailable" }, 500);
      }
    });

    app.get("/api/lessons", async (c) => {
      try {
        const store = EventStore.getInstance();
        const repoId = store.ensureRepository(this.resolveSelectedPath(c.req.query("project"))).id;
        const db = (store as any).db;
        const lessons = db.prepare("SELECT * FROM lessons WHERE repo_id = ? ORDER BY created_at DESC").all(repoId);
        return c.json(lessons);
      } catch (error) {
        this.logRouteError("api/lessons", error);
        return c.json({ error: "Lessons unavailable" }, 500);
      }
    });

    app.get("/api/templates", async (c) => {
      try {
        const store = EventStore.getInstance();
        const repoId = store.ensureRepository(this.resolveSelectedPath(c.req.query("project"))).id;
        const db = (store as any).db;
        const templates = db.prepare("SELECT * FROM prompt_templates WHERE repo_id = ? ORDER BY success_score DESC").all(repoId);
        return c.json(templates);
      } catch (error) {
        this.logRouteError("api/templates", error);
        return c.json({ error: "Templates unavailable" }, 500);
      }
    });

    app.post("/api/review/:kind/:id", async (c) => {
      const selectedPath = this.resolveSelectedPath(c.req.query("project"));
      try {
        if (!isSameOriginRequest(c.req.header("origin"), c.req.url)) {
          return c.json({ error: "Cross-origin review requests are not allowed" }, 403);
        }
        if (!isJsonContentType(c.req.header("content-type"))) {
          return c.json({ error: "Review requests must use application/json" }, 415);
        }

        const kind = c.req.param("kind");
        if (kind !== "lesson" && kind !== "template") {
          return c.json({ error: "Unsupported review candidate type" }, 400);
        }

        let body: { decision?: unknown };
        try {
          body = await c.req.json() as { decision?: unknown };
        } catch {
          return c.json({ error: "Review request body must be valid JSON" }, 400);
        }
        if (body.decision !== "approve" && body.decision !== "reject") {
          return c.json({ error: "Decision must be approve or reject" }, 400);
        }

        const id = c.req.param("id");
        if (!id || id.length > 200) {
          return c.json({ error: "Review candidate ID is invalid" }, 400);
        }
        const store = EventStore.getInstance();
        const repoId = store.ensureRepository(selectedPath).id;
        const approved = body.decision === "approve";
        const changed = kind === "lesson"
          ? store.reviewLesson(repoId, id, approved)
          : store.reviewTemplate(repoId, id, approved);
        if (!changed) {
          return c.json({ error: `Pending ${kind} not found for selected repository` }, 404);
        }

        store.recordEvent({
          id: `evt_dashboard_review_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
          event_type: `${kind}_reviewed`,
          repo_id: repoId,
          summary: `${kind === "lesson" ? "Lesson" : "Template"} ${approved ? "approved" : "rejected"} from dashboard`,
          details_json: JSON.stringify({ candidateId: id, decision: body.decision }),
        });
        this.log(`${kind === "lesson" ? "Lesson" : "Template"} ${approved ? "approved" : "rejected"}: ${id}`, selectedPath);
        return c.json({ id, kind, decision: body.decision, repoId });
      } catch (error) {
        this.logRouteError("api/review", error, selectedPath);
        return c.json({ error: "Review request failed" }, 500);
      }
    });

    app.get("/api/autopilot", (c) => {
      try {
        return c.json(AutoPilotStatus.getSnapshot());
      } catch (error) {
        this.logRouteError("api/autopilot", error);
        return c.json({ error: "Auto-pilot status unavailable" }, 500);
      }
    });

    app.get("/api/health", async (c) => {
      const selectedPath = this.resolveSelectedPath(c.req.query("project"));
      try {
        return c.json(this.buildHealth(selectedPath));
      } catch (error) {
        this.logRouteError("api/health", error, selectedPath);
        return c.json({ error: "Provider health unavailable" }, 500);
      }
    });

    app.get("/api/events", async (c) => {
      try {
        return streamSSE(c, async (stream) => {
          let closed = false;
          const pushUpdate = () => {
            if (closed) {
              return;
            }
            void stream.writeSSE({
              event: "update",
              data: "update",
              id: String(Date.now()),
            });
          };
          const unsubscribe = AgenticBlackboard.onUpdate(pushUpdate);
          c.req.raw.signal.addEventListener("abort", () => {
            closed = true;
            unsubscribe();
          }, { once: true });
          await stream.writeSSE({ event: "ready", data: "connected", id: String(Date.now()) });
          while (!closed) {
            await stream.sleep(30000);
            await stream.writeSSE({ event: "ping", data: "ping", id: String(Date.now()) });
          }
        });
      } catch (error) {
        this.logRouteError("api/events", error, this.rootPath);
        return c.text("Dashboard event stream unavailable", 500);
      }
    });

    app.get("/", async (c) => {
      const selectedPath = this.resolveSelectedPath(c.req.query("project"));

      try {
        const state = await this.buildState(selectedPath);
        const serializedState = JSON.stringify(state).replace(/</g, "\\u003c");

        // Robust path resolution: try __dirname first, then project root relative
        const possiblePaths = [
          path.join(__dirname, "dashboard.html"),
          path.join(process.cwd(), "universal-refiner", "src", "core", "dashboard.html"),
          path.join(process.cwd(), "src", "core", "dashboard.html"),
          path.join(process.cwd(), "dist", "src", "core", "dashboard.html")
        ];

        let html = "";
        let found = false;
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            html = fs.readFileSync(p, "utf-8");
            found = true;
            break;
          }
        }

        if (!found) {
          throw new Error(`Could not find dashboard.html in any of: ${possiblePaths.join(", ")}`);
        }
        
        // Inject data and version
        html = html.replace("{{STATE_JSON}}", serializedState);
        html = html.replace("V1.0.0", `V${getDisplayVersion()}`);

        return c.html(html);
      } catch (error) {
        this.logRouteError("/", error, selectedPath);
        return c.html(`<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;background:#020617;color:#f8fafc;padding:2rem;"><h1>Dashboard Error</h1><p>The dashboard failed to render. See sanitized runtime logs.</p></body></html>`, 500);
      }
    });

    return app;
  }

  static start(port = 3000, defaultPath = ".") {
    const app = this.createApp(defaultPath);
    try {
      const server = serve({ fetch: app.fetch, port, hostname: resolveDashboardHost() });
      this.server = server;
      server.on("error", (e: any) => {
        if (e.code === "EADDRINUSE") {
          console.error(`[Command Center] Port ${port} taken.`);
          RuntimeLogger.error(`Dashboard port ${port} already in use`, e);
        } else {
          RuntimeLogger.error(`Dashboard server emitted error on port ${port}`, e);
        }
      });
    } catch (error) {
      RuntimeLogger.error(`Dashboard failed to start on port ${port}`, error);
      throw error;
    }
  }

  static async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}
