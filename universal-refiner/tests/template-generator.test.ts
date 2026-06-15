import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventStore } from "../src/history/event-store.js";
import { TemplateGenerator } from "../src/history/template-generator.js";

describe("TemplateGenerator", () => {
  let testDir: string;
  let store: EventStore;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "template-generator-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = testDir;
    (EventStore as any).instance = null;
    store = EventStore.getInstance();
  });

  afterEach(() => {
    store.close();
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function addStory(id: string, repoId = "repo") {
    const db = (store as any).db;
    store.recordPrompt({ id: `prompt-${id}`, repo_id: repoId, client: "test", raw_prompt: `Prompt ${id}` });
    store.recordExecution({
      id: `execution-${id}`,
      prompt_id: `prompt-${id}`,
      workflow_name: "test",
      executor_name: "test",
      status: "completed",
      result_summary: `Result ${id}`,
    });
    store.recordCommit({
      id: `commit-${id}`,
      repo_id: repoId,
      sha: `sha-${id}`,
      message: `feat: story ${id}`,
      committed_at: new Date().toISOString(),
      changed_files_json: JSON.stringify([`src/${id}.ts`]),
    });
    db.prepare("INSERT INTO execution_commits (execution_id, commit_id) VALUES (?, ?)").run(`execution-${id}`, `commit-${id}`);
  }

  it("does not invoke synthesis without enough successful history", async () => {
    addStory("one");
    const request = vi.fn();
    await new TemplateGenerator(request).generateNewTemplates("repo");
    expect(request).not.toHaveBeenCalled();
  });

  it("records synthesized templates and ignores unavailable or malformed responses", async () => {
    addStory("one");
    addStory("two");
    const valid = JSON.stringify({
      templates: [{
        name: "Verified feature",
        category: "feature",
        template_text: "Implement [INTENT] and verify it.",
        usage_notes: "Use for features.",
        success_score: 95,
      }],
    });
    const request = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(valid);
    const generator = new TemplateGenerator(request);

    await generator.generateNewTemplates("repo");
    await generator.generateNewTemplates("repo");
    await generator.generateNewTemplates("repo");

    const templates = (store as any).db.prepare("SELECT * FROM prompt_templates WHERE repo_id = ?").all("repo");
    expect(templates).toMatchObject([{ title: "Verified feature", success_score: 95 }]);
    expect(request.mock.calls[2][1]).toContain("feat: story one");
  });
});
