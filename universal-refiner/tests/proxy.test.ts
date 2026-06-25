// secret-scan: allow-fixture
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CommandCenterDashboard } from "../src/core/dashboard.js";
import { ConfigManager, type SemanticConfig } from "../src/core/config.js";
import { EventStore } from "../src/history/event-store.js";

describe("dashboard OpenAI-compatible proxy route", () => {
  let testDir: string;
  let repoDir: string;
  let store: EventStore;
  const semanticConfig: SemanticConfig = {
    localEnabled: true,
    mcpSamplingEnabled: false,
    baseUrl: "http://127.0.0.1:9000/v1",
    models: ["gemma3:12b"],
    timeoutMs: 1_000,
    temperature: 0.2,
    allowNonLoopback: false,
  };

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-route-"));
    repoDir = path.join(testDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(testDir, "global");
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    store = EventStore.getInstance();
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValue(semanticConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.close();
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("records the prompt, forwards the request, and records a completed execution", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("mock LLM response", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = CommandCenterDashboard.createApp(repoDir);

    const response = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer local-token",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Improve this prompt" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("mock LLM response");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9000/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "Authorization": "Bearer local-token",
      }),
    }));

    const db = (store as any).db;
    const prompt = db.prepare("SELECT * FROM prompts WHERE client = ?").get("API_PROXY");
    expect(prompt.raw_prompt).toBe("Improve this prompt");
    const execution = db.prepare("SELECT * FROM executions WHERE prompt_id = ?").get(prompt.id);
    expect(execution).toMatchObject({
      workflow_name: "proxy_forward",
      executor_name: "LocalLLM",
      status: "completed",
      artifacts_json: "{}",
    });
  });

  it("supports trailing-slash base URLs and falls back when no prompt message is present", async () => {
    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValueOnce({
      ...semanticConfig,
      baseUrl: "http://127.0.0.1:9000/v1/",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = CommandCenterDashboard.createApp(repoDir);

    const response = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: "not-an-array" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9000/v1/chat/completions", expect.objectContaining({
      headers: { "Content-Type": "application/json" },
    }));
    const db = (store as any).db;
    expect(db.prepare("SELECT raw_prompt FROM prompts WHERE client = ?").get("API_PROXY"))
      .toEqual({ raw_prompt: "Unknown proxy prompt" });
  });

  it("rejects malformed proxy requests before forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = CommandCenterDashboard.createApp(repoDir);

    expect((await app.request("/proxy/v1/chat/completions", { method: "POST", body: "{}" })).status).toBe(415);
    expect((await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })).status).toBe(400);

    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValueOnce({
      ...semanticConfig,
      baseUrl: "https://remote.example/v1",
      allowNonLoopback: false,
    });
    expect((await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).status).toBe(403);

    vi.spyOn(ConfigManager, "getSemanticConfig").mockReturnValueOnce({
      ...semanticConfig,
      baseUrl: "not a url",
    });
    expect((await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records failed executions for upstream HTTP and network failures", async () => {
    const app = CommandCenterDashboard.createApp(repoDir);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("token=secret-value", { status: 503, statusText: "Unavailable" }))
      .mockRejectedValueOnce(new Error("connection refused with token=secret-value")));

    const upstreamFailure = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "First" }] }),
    });
    expect(upstreamFailure.status).toBe(503);
    expect(await upstreamFailure.text()).toBe("token=secret-value");

    const networkFailure = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Second" }] }),
    });
    expect(networkFailure.status).toBe(502);
    expect(await networkFailure.json()).toEqual({ error: "Proxy request failed" });

    const db = (store as any).db;
    const failures = db.prepare("SELECT * FROM executions WHERE status = 'failed' ORDER BY started_at ASC").all();
    expect(failures).toHaveLength(2);
    expect(failures[0].result_summary).toContain("Upstream error: 503");
    expect(failures[0].artifacts_json).toContain("token=[REDACTED]");
    expect(failures[1].result_summary).toContain("Network error reaching upstream");
    expect(failures[1].artifacts_json).toContain("token=[REDACTED]");
  });

  it("records non-Error network failures", async () => {
    const app = CommandCenterDashboard.createApp(repoDir);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string failure token=secret-value"));

    const response = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Prompt" }] }),
    });

    expect(response.status).toBe(502);
    const db = (store as any).db;
    const failure = db.prepare("SELECT * FROM executions WHERE status = 'failed'").get();
    expect(failure.result_summary).toContain("string failure");
    expect(failure.artifacts_json).toContain("token=[REDACTED]");
  });

  it("uses approved minified templates transparently and ignores invalid template regexes", async () => {
    const repoId = store.ensureRepository(repoDir).id;
    store.recordTemplate({
      id: "non-minified",
      repo_id: repoId,
      category: "Feature",
      title: "Non-minified",
      template_text: "feature",
      usage_notes: "^Verbose prompt$",
      source_type: "test",
      success_score: 200,
      approved: 1,
    });
    store.recordTemplate({
      id: "bad-regex",
      repo_id: repoId,
      category: "Minified",
      title: "Bad regex",
      template_text: "bad",
      usage_notes: "[",
      source_type: "test",
      success_score: 150,
      approved: 1,
    });
    store.recordTemplate({
      id: "approved-minified",
      repo_id: repoId,
      category: "Minified",
      title: "Approved minified",
      template_text: "Short prompt",
      usage_notes: "^Verbose prompt$",
      source_type: "test",
      success_score: 100,
      approved: 1,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = CommandCenterDashboard.createApp(repoDir);

    const response = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Verbose prompt" }] }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9000/v1/chat/completions", expect.objectContaining({
      body: JSON.stringify({ messages: [{ role: "user", content: "Short prompt" }] }),
    }));
    const db = (store as any).db;
    expect(db.prepare("SELECT raw_prompt, normalized_prompt FROM prompts WHERE client = ?").get("API_PROXY"))
      .toEqual({ raw_prompt: "Verbose prompt", normalized_prompt: "Short prompt" });
  });

  it("records a matching minified fallback without mutating non-string message content", async () => {
    const repoId = store.ensureRepository(repoDir).id;
    store.recordTemplate({
      id: "unknown-minified",
      repo_id: repoId,
      category: "Minified",
      title: "Unknown fallback",
      template_text: "Short fallback",
      usage_notes: "^Unknown proxy prompt$",
      source_type: "test",
      success_score: 100,
      approved: 1,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = CommandCenterDashboard.createApp(repoDir);
    const body = { messages: [{ role: "user", content: { text: "not a string" } }] };

    const response = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9000/v1/chat/completions", expect.objectContaining({
      body: JSON.stringify(body),
    }));
    const db = (store as any).db;
    expect(db.prepare("SELECT raw_prompt, normalized_prompt FROM prompts WHERE client = ?").get("API_PROXY"))
      .toEqual({ raw_prompt: "Unknown proxy prompt", normalized_prompt: "Short fallback" });
  });

  it("returns a sanitized route failure when proxy bookkeeping fails", async () => {
    const app = CommandCenterDashboard.createApp(repoDir);
    vi.spyOn(EventStore, "getInstance").mockImplementationOnce(() => {
      throw new Error("store secret");
    });

    const response = await app.request("/proxy/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Proxy request failed" });
  });
});
