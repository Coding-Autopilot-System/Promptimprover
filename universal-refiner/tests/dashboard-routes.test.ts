import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CommandCenterDashboard } from "../src/core/dashboard.js";
import { EventStore } from "../src/history/event-store.js";

describe("dashboard route coverage", () => {
  let testDir: string;
  let repoDir: string;
  let store: EventStore;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-routes-"));
    repoDir = path.join(testDir, "repo");
    fs.mkdirSync(repoDir);
    fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(testDir, "global");
    (EventStore as any).instance = null;
    store = EventStore.getInstance();
  });

  afterEach(() => {
    store.close();
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("serves state, timeline, commits, lessons, templates, health, and HTML", async () => {
    const repoId = store.ensureRepository(repoDir).id;
    store.recordPrompt({ id: "prompt", repo_id: repoId, client: "test", raw_prompt: "Implement feature" });
    store.recordCommit({
      id: "commit",
      repo_id: repoId,
      sha: "abc",
      message: "feat: test",
      committed_at: new Date().toISOString(),
    });
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
      category: "feature",
      title: "Template",
      template_text: "Implement it.",
      usage_notes: "",
      source_type: "test",
      success_score: 80,
    });
    const app = CommandCenterDashboard.createApp(repoDir);

    for (const route of ["/api/state", "/api/timeline", "/api/commits", "/api/lessons", "/api/templates", "/api/health", "/"]) {
      const response = await app.request(route);
      expect(response.status, route).toBe(200);
    }
    const fallback = await app.request(`/api/state?project=${encodeURIComponent(path.join(testDir, "not-visible"))}`);
    expect((await fallback.json() as any).selectedPath).toBe(path.resolve(repoDir));
  });

  it("validates every review mutation boundary", async () => {
    const app = CommandCenterDashboard.createApp(repoDir);
    const request = (route: string, body = "{}", headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost" }) =>
      app.request(route, { method: "POST", headers, body });

    expect((await request("/api/review/unsupported/id", JSON.stringify({ decision: "approve" }))).status).toBe(400);
    expect((await request("/api/review/lesson/id", "{}", { origin: "http://localhost" })).status).toBe(415);
    expect((await request("/api/review/lesson/id", "{")).status).toBe(400);
    expect((await request("/api/review/lesson/id", JSON.stringify({ decision: "approve" }), {
      "content-type": "application/json",
      origin: "https://attacker.example",
    })).status).toBe(403);
    expect((await request(`/api/review/lesson/${"x".repeat(201)}`, JSON.stringify({ decision: "approve" }))).status).toBe(400);
  });
});
