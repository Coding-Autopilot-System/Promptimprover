import { describe, expect, it } from "vitest";
import {
  comparePrompts,
  createABEvaluationRecord,
  evaluatePrompt
} from "../src/evaluation/prompt-evaluator.js";

describe("deterministic prompt evaluation", () => {
  it("scores evidence-oriented dimensions and labels the result as heuristic", () => {
    const evaluation = evaluatePrompt(
      "Implement src/auth.ts. Preserve existing behavior, add tests, run npm test, and report results.",
      "Implement auth"
    );

    expect(evaluation.heuristicScore).toBeGreaterThan(50);
    expect(evaluation.dimensions.testability.evidence).toContain("test-command");
    expect(evaluation.dimensions.riskControls.evidence).toContain("compatibility-or-regression");
    expect(evaluation.disclaimer).toContain("not an LLM quality judgment");
  });

  it("compares original and refined prompts without rewarding length alone", () => {
    const original = "Fix login";
    const verbose = `${original} ${"background ".repeat(500)}`;
    const actionable = "Fix login in src/auth.ts. Preserve existing behavior, add tests, run npm test, and report results.";

    expect(comparePrompts(original, verbose).heuristicDelta).toBe(0);
    expect(comparePrompts(original, actionable).heuristicPreference).toBe("refined");
  });

  it("records A/B heuristic preference separately from observed evidence", () => {
    const record = createABEvaluationRecord({
      experimentId: "exp-1",
      createdAt: "2026-06-14T00:00:00.000Z",
      baselinePrompt: "Fix login",
      variantA: {
        id: "A",
        prompt: "Fix login and add tests.",
        observedOutcome: { status: "failed", testsFailed: 1 }
      },
      variantB: {
        id: "B",
        prompt: "Fix login in src/auth.ts. Preserve behavior and run npm test.",
        observedOutcome: { status: "completed", testsPassed: 10 }
      }
    });

    expect(record.heuristicPreference).toBe("B");
    expect(record.observedWinner).toBe("B");
    expect(record.interpretation).toBe("observed-evidence");
  });

  it("does not declare an observed winner without outcomes from both variants", () => {
    const record = createABEvaluationRecord({
      experimentId: "exp-2",
      baselinePrompt: "Add login",
      variantA: { id: "A", prompt: "Add login" },
      variantB: { id: "B", prompt: "Add login with tests." }
    });

    expect(record.observedWinner).toBeUndefined();
    expect(record.interpretation).toBe("heuristic-only");
  });
});
