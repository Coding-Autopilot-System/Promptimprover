import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommandCenterDashboard, isSameOriginRequest } from "../src/core/dashboard.js";
import { EventStore } from "../src/history/event-store.js";

describe("dashboard review and health APIs", () => {
  const testDir = path.join(os.tmpdir(), `refiner-dashboard-api-${Date.now()}`);
  const repoDir = path.join(testDir, "selected-repo");

  beforeEach(() => {
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(testDir, "global");
    (EventStore as any).instance = null;
  });

  afterEach(() => {
    const instance = (EventStore as any).instance as EventStore | null;
    instance?.close();
    (EventStore as any).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("allows missing or same-origin origins and rejects cross-origin requests", () => {
    expect(isSameOriginRequest(undefined, "http://127.0.0.1:3000/api/review/lesson/1")).toBe(true);
    expect(isSameOriginRequest("http://127.0.0.1:3000", "http://127.0.0.1:3000/api/review/lesson/1")).toBe(true);
    expect(isSameOriginRequest("https://attacker.example", "http://127.0.0.1:3000/api/review/lesson/1")).toBe(false);
  });

  it("reviews only pending candidates in the selected repository", async () => {
    const store = EventStore.getInstance();
    const repoId = store.ensureRepository(repoDir).id;
    store.recordLesson({
      id: "selected-lesson",
      repo_id: repoId,
      lesson_type: "quality",
      title: "Selected",
      summary: "Selected repo lesson",
      confidence: "high",
      source: "test",
    });
    store.recordLesson({
      id: "other-lesson",
      repo_id: "other-repo",
      lesson_type: "quality",
      title: "Other",
      summary: "Other repo lesson",
      confidence: "high",
      source: "test",
    });
    store.recordTemplate({
      id: "selected-template",
      repo_id: repoId,
      category: "quality",
      title: "Selected template",
      template_text: "Do the work",
      usage_notes: "test",
      source_type: "test",
      success_score: 90,
    });
    const app = CommandCenterDashboard.createApp(repoDir);

    const lessonResponse = await app.request("/api/review/lesson/selected-lesson", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(lessonResponse.status).toBe(200);

    const templateResponse = await app.request("/api/review/template/selected-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject" }),
    });
    expect(templateResponse.status).toBe(200);

    const scopedResponse = await app.request("/api/review/lesson/other-lesson", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(scopedResponse.status).toBe(404);

    expect(store.getLearningCandidates(repoId)).toEqual({ lessons: [], templates: [] });
    expect(store.getLearningCandidates("other-repo").lessons).toHaveLength(1);
    const db = (store as any).db;
    expect(db.prepare("SELECT COUNT(*) AS count FROM events WHERE repo_id = ? AND event_type IN ('lesson_reviewed', 'template_reviewed')")
      .get(repoId).count).toBe(2);
  });

  it("rejects cross-origin and malformed review mutations", async () => {
    const app = CommandCenterDashboard.createApp(repoDir);
    const crossOrigin = await app.request("http://localhost/api/review/lesson/x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(crossOrigin.status).toBe(403);

    const invalidDecision = await app.request("/api/review/lesson/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "delete" }),
    });
    expect(invalidDecision.status).toBe(400);

    const invalidJson = await app.request("/api/review/lesson/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
  });

  it("returns sanitized semantic provider and runtime health", async () => {
    fs.writeFileSync(path.join(repoDir, ".gemini-refiner.json"), JSON.stringify({
      semantic: {
        baseUrl: "http://secret-user:secret-pass@localhost:9000/v1?token=secret",
        models: ["gemma3:12b"],
      },
    }));
    const store = EventStore.getInstance();
    const repoId = store.ensureRepository(repoDir).id;
    store.recordEvent({
      id: "semantic-safe",
      event_type: "semantic_request_completed",
      repo_id: repoId,
      summary: "safe",
      timestamp: "2026-06-14T10:00:00.000Z",
      details_json: JSON.stringify({
        taskName: "lint_prompt",
        provider: "local-openai",
        model: "gemma3:12b",
        latencyMs: 125,
        fallbackFrom: ["model:gemma3:1b"],
        prompt: "private prompt",
        apiKey: "private key",
      }),
    });
    const app = CommandCenterDashboard.createApp(repoDir);

    const response = await app.request("/api/health");
    const health = await response.json() as any;
    const serialized = JSON.stringify(health);

    expect(response.status).toBe(200);
    expect(health.semantic.status).toBe("healthy");
    expect(health.semantic.local.endpoint).toBe("http://localhost:9000");
    expect(health.semantic.totals).toEqual({
      completed: 1,
      averageLatencyMs: 125,
      fallbackCompletions: 1,
    });
    expect(health.semantic.lastSuccess.provider).toBe("local-openai");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("apiKey");
  });

  it("renders review controls and provider health UI", async () => {
    const app = CommandCenterDashboard.createApp(repoDir);
    const response = await app.request("/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("reviewCandidate");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("PROVIDER HEALTH");
    expect(html).toContain("/api/health");
  });
});
