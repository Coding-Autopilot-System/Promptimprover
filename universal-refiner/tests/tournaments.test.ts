import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventStore } from "../src/history/event-store.js";
import { createABEvaluationRecord } from "../src/evaluation/prompt-evaluator.js";

describe("A/B Prompt Tournaments", () => {
  let store: EventStore;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-tournaments-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(testDir, "global");
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    store = EventStore.getInstance();
  });

  afterEach(() => {
    store.close();
    (EventStore as unknown as { instance: EventStore | null }).instance = null;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should evaluate and record an A/B tournament correctly", () => {
    const baseline = "Write a test.";
    const variantA = "Write a unit test for the login function verifying the 404 response.";
    const variantB = "Test login.";

    const experiment = createABEvaluationRecord({
      experimentId: "exp_test_123",
      baselinePrompt: baseline,
      variantA: { id: "A", prompt: variantA },
      variantB: { id: "B", prompt: variantB }
    });

    const winner = experiment.heuristicPreference;

    store.recordTournament({
      id: experiment.experimentId,
      repo_id: "test-repo",
      baseline_prompt: baseline,
      variant_a: variantA,
      variant_b: variantB,
      winner_observed: winner,
      details_json: JSON.stringify(experiment)
    });

    const results = store.getTournaments("test-repo");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("exp_test_123");
    expect(results[0].winner_observed).toBe(winner);
  });
});
