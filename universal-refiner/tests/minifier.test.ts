import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventStore } from "../src/history/event-store.js";
import { TokenMinifier } from "../src/refiners/minifier.js";
import { createABEvaluationRecord } from "../src/evaluation/prompt-evaluator.js";

vi.mock("../src/evaluation/prompt-evaluator.js", () => ({
  createABEvaluationRecord: vi.fn().mockReturnValue({
    heuristicPreference: "A",
    variantA: { evaluation: { heuristicScore: 10 } }
  })
}));

describe("Token Minifier", () => {
  let store: EventStore;

  beforeEach(() => {
    store = EventStore.getInstance();
    const db = (store as any).db;
    db.prepare("DELETE FROM events").run();
    db.prepare("DELETE FROM prompts").run();
    db.prepare("DELETE FROM prompt_templates").run();
    db.prepare("DELETE FROM tournaments").run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const db = (store as any).db;
    db.prepare("DELETE FROM events").run();
    db.prepare("DELETE FROM prompts").run();
    db.prepare("DELETE FROM prompt_templates").run();
    db.prepare("DELETE FROM tournaments").run();
  });

  it("should compress long verbose prompts into templates automatically", async () => {
    // Generate a prompt string longer than 300 characters
    const longPrompt = "Hello AI, I need you to do something for me. ".repeat(15) + "Please make sure to write a unit test for this.";

    // Insert dummy prompt
    store.recordPrompt({
      id: "prm_1",
      client: "API_PROXY",
      agent_name: "ProxyClient",
      raw_prompt: longPrompt,
      repo_id: "test-repo"
    });

    const mockLocalModel = vi.fn().mockResolvedValue("MUST write a unit test. Format: JSON. Ensure coverage. DO NOT fail.");
    const minifier = new TokenMinifier(mockLocalModel);

    const count = await minifier.minifyVerbosePrompts();

    expect(count).toBe(1);
    expect(mockLocalModel).toHaveBeenCalled();

    const templates = store.getLearningCandidates("test-repo").templates;
    expect(templates).toHaveLength(1);
    expect(templates[0].template_text).toBe("MUST write a unit test. Format: JSON. Ensure coverage. DO NOT fail.");
    expect(templates[0].approved).toBe(0);
    expect(store.getTemplates("test-repo")).toHaveLength(0);
  });

  it("does not duplicate templates for the same repository and source prompt", async () => {
    const longPrompt = "Please preserve every requirement while shortening this prompt. ".repeat(10);
    store.recordPrompt({
      id: "prm_1",
      client: "API_PROXY",
      agent_name: "ProxyClient",
      raw_prompt: longPrompt,
      repo_id: "test-repo"
    });
    store.recordTemplate({
      id: "tpl_existing",
      repo_id: "test-repo",
      category: "Minified",
      title: "Existing",
      template_text: "short",
      usage_notes: "^" + longPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$",
      source_type: "auto",
      success_score: 10,
    });

    const mockLocalModel = vi.fn().mockResolvedValue("shorter");
    await expect(new TokenMinifier(mockLocalModel).minifyVerbosePrompts()).resolves.toBe(0);
    expect(mockLocalModel).not.toHaveBeenCalled();
  });

  it("skips short, repository-less, empty, longer, and losing minifications", async () => {
    const longPrompt = "Please compress this long prompt while keeping requirements. ".repeat(8);
    const longerPrompt = "Please compress this second long prompt while keeping requirements. ".repeat(8);
    const losingPrompt = "Please compress this third long prompt while keeping requirements. ".repeat(8);

    store.recordPrompt({
      id: "short",
      client: "API_PROXY",
      raw_prompt: "short",
      repo_id: "test-repo",
      timestamp: "2026-06-24T00:00:05.000Z",
    });
    store.recordPrompt({
      id: "no-repo",
      client: "API_PROXY",
      raw_prompt: longPrompt,
      timestamp: "2026-06-24T00:00:04.000Z",
    });
    store.recordPrompt({
      id: "empty",
      client: "API_PROXY",
      raw_prompt: longPrompt,
      repo_id: "test-repo",
      timestamp: "2026-06-24T00:00:03.000Z",
    });
    store.recordPrompt({
      id: "longer",
      client: "API_PROXY",
      raw_prompt: longerPrompt,
      repo_id: "test-repo",
      timestamp: "2026-06-24T00:00:02.000Z",
    });
    store.recordPrompt({
      id: "losing",
      client: "API_PROXY",
      raw_prompt: losingPrompt,
      repo_id: "test-repo",
      timestamp: "2026-06-24T00:00:01.000Z",
    });

    vi.mocked(createABEvaluationRecord).mockReturnValueOnce({
      heuristicPreference: "B",
      variantA: { evaluation: { heuristicScore: 1 } }
    } as any);
    const mockLocalModel = vi.fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(longerPrompt + " not shorter")
      .mockResolvedValueOnce("short but loses");

    await expect(new TokenMinifier(mockLocalModel).minifyVerbosePrompts()).resolves.toBe(0);

    expect(mockLocalModel).toHaveBeenCalledTimes(3);
    expect(store.getLearningCandidates("test-repo").templates).toHaveLength(0);
  });
});
