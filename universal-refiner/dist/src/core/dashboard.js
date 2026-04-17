import { Hono } from "hono";
import * as fs from "fs";
import { serve } from "@hono/node-server";
import { AgenticBlackboard } from "./blackboard.js";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../detectors/project-scout.js";
import * as path from "path";
import { fileURLToPath } from "url";
import { streamSSE } from "hono/streaming";
import { getDisplayVersion } from "./version.js";
import { RuntimeLogger } from "./logger.js";
import { TimelineProvider } from "../history/timeline.js";
import { EventStore } from "../history/event-store.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class CommandCenterDashboard {
    static rootPath = ".";
    static async setLastRefinement(original, refined, projectPath = ".", gain = 0) {
        await AgenticBlackboard.setLastRefinement(original, refined, projectPath, gain);
    }
    static log(message, projectPath = ".") {
        AgenticBlackboard.postLog(message, projectPath);
    }
    static getVisibleProjects() {
        const globalData = AgenticBlackboard.getGlobalData();
        const uniqueProjects = new Set([
            path.resolve(this.rootPath),
            ...(globalData.projects || []).map(projectPath => path.resolve(projectPath))
        ]);
        return [...uniqueProjects].filter(projectPath => fs.existsSync(projectPath));
    }
    static logRouteError(routeName, error, selectedPath) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        RuntimeLogger.error(`Dashboard route failed: ${routeName}`, {
            selectedPath: selectedPath || this.rootPath,
            error: message,
        });
        console.error(`[Dashboard:${routeName}]`, message);
        AgenticBlackboard.postLog(`Dashboard ${routeName} error: ${message.split("\n")[0]}`, selectedPath || this.rootPath);
    }
    static resolveSelectedPath(projectParam) {
        const projects = new Set(this.getVisibleProjects());
        const requestedPath = projectParam ? path.resolve(projectParam) : path.resolve(this.rootPath);
        if (projects.has(requestedPath)) {
            return requestedPath;
        }
        return path.resolve(this.rootPath);
    }
    static async buildState(selectedPath) {
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
    static start(port = 3000, defaultPath = ".") {
        this.rootPath = defaultPath;
        const app = new Hono();
        app.get("/api/state", async (c) => {
            const selectedPath = this.resolveSelectedPath(c.req.query("project"));
            try {
                const state = await this.buildState(selectedPath);
                return c.json(state);
            }
            catch (error) {
                this.logRouteError("api/state", error, selectedPath);
                return c.json({ error: "Dashboard state unavailable", selectedPath }, 500);
            }
        });
        app.get("/api/timeline", async (c) => {
            try {
                const provider = new TimelineProvider();
                const timeline = provider.getUnifiedTimeline(50);
                return c.json(timeline);
            }
            catch (error) {
                this.logRouteError("api/timeline", error);
                return c.json({ error: "Timeline unavailable" }, 500);
            }
        });
        app.get("/api/commits", async (c) => {
            try {
                const repoId = path.basename(this.resolveSelectedPath(c.req.query("project")));
                const db = EventStore.getInstance().db;
                const commits = db.prepare(`
          SELECT c.*, e.prompt_id, e.id as execution_id
          FROM commits c
          LEFT JOIN execution_commits ec ON c.id = ec.commit_id
          LEFT JOIN executions e ON ec.execution_id = e.id
          WHERE c.repo_id = ?
          ORDER BY c.committed_at DESC LIMIT 50
        `).all(repoId);
                return c.json(commits);
            }
            catch (error) {
                this.logRouteError("api/commits", error);
                return c.json({ error: "Commits unavailable" }, 500);
            }
        });
        app.get("/api/lessons", async (c) => {
            try {
                const repoId = path.basename(this.resolveSelectedPath(c.req.query("project")));
                const db = EventStore.getInstance().db;
                const lessons = db.prepare("SELECT * FROM lessons WHERE repo_id = ? ORDER BY created_at DESC").all(repoId);
                return c.json(lessons);
            }
            catch (error) {
                this.logRouteError("api/lessons", error);
                return c.json({ error: "Lessons unavailable" }, 500);
            }
        });
        app.get("/api/templates", async (c) => {
            try {
                const repoId = path.basename(this.resolveSelectedPath(c.req.query("project")));
                const db = EventStore.getInstance().db;
                const templates = db.prepare("SELECT * FROM prompt_templates WHERE repo_id = ? ORDER BY success_score DESC").all(repoId);
                return c.json(templates);
            }
            catch (error) {
                this.logRouteError("api/templates", error);
                return c.json({ error: "Templates unavailable" }, 500);
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
            }
            catch (error) {
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
            }
            catch (error) {
                this.logRouteError("/", error, selectedPath);
                return c.html(`<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;background:#020617;color:#f8fafc;padding:2rem;"><h1>Dashboard Error</h1><p>The dashboard failed to render.</p><pre>${String(error instanceof Error ? error.stack || error.message : error)}</pre></body></html>`, 500);
            }
        });
        try {
            const server = serve({ fetch: app.fetch, port });
            server.on("error", (e) => {
                if (e.code === "EADDRINUSE") {
                    console.error(`[Command Center] Port ${port} taken.`);
                    RuntimeLogger.error(`Dashboard port ${port} already in use`, e);
                }
                else {
                    RuntimeLogger.error(`Dashboard server emitted error on port ${port}`, e);
                }
            });
        }
        catch (error) {
            RuntimeLogger.error(`Dashboard failed to start on port ${port}`, error);
            throw error;
        }
    }
}
