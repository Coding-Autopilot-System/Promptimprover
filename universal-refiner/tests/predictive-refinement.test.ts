import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PromptRefiner } from "../src/refiners/prompt-refiner.js";
import { ProjectContext } from "../src/detectors/project-scout.js";

describe("PromptRefiner with Predictive Lessons", () => {
  it("should include predictive lessons in the output", () => {
    const ctx: ProjectContext = {
      language: "TypeScript",
      framework: "Vitest",
      testing: "Vitest",
      isTypeScript: true,
      predictiveLessons: [
        { title: "Test Lesson", summary: "Use secure headers", confidence: "high" }
      ]
    };

    const refined = PromptRefiner.refine("Add login", ctx, {});
    expect(refined).toContain("Predictive Autonomous Lessons");
    expect(refined).toContain("Use secure headers");
  });

  it("should increase gain when predictive lessons are present", () => {
    const ctxWithLessons: ProjectContext = {
      language: "TypeScript",
      framework: "Vitest",
      testing: "Vitest",
      isTypeScript: true,
      predictiveLessons: [{ title: "L1", summary: "S1", confidence: "high" }]
    };

    const ctxWithout: ProjectContext = {
      language: "TypeScript",
      framework: "Vitest",
      testing: "Vitest",
      isTypeScript: true
    };

    const gainWith = PromptRefiner.calculateGain("prompt", "long refined prompt", ctxWithLessons);
    const gainWithout = PromptRefiner.calculateGain("prompt", "long refined prompt", ctxWithout);

    expect(gainWith).toBeGreaterThan(gainWithout);
  });
});
