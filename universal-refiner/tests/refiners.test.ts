import { describe, it, expect } from "vitest";
import { PromptRefiner } from "../src/refiners/prompt-refiner.js";
import { ProjectContext } from "../src/detectors/project-scout.js";

describe("PromptRefiner", () => {
  const baseCtx: ProjectContext = {
    language: "TypeScript",
    framework: "React",
    testing: "Vitest",
    isTypeScript: true,
    packageManager: "npm",
    architecturalPatterns: [],
    learnedPatterns: [],
    relevantSnippets: [],
    activeIntents: []
  };

  it("should generate a refined prompt with basic context", () => {
    const prompt = "Create a login button";
    const refined = PromptRefiner.refine(prompt, baseCtx, { size: "small" });
    expect(refined).toContain("Create a login button");
    expect(refined).toContain("TypeScript");
    expect(refined).toContain("React");
    expect(refined).toContain("size: small");
  });

  it("should inject architectural mandates", () => {
    const ctx = { ...baseCtx, architecturalPatterns: ["Clean Architecture / DDD"] };
    const prompt = "Implement user storage";
    const refined = PromptRefiner.refine(prompt, ctx, {});
    expect(refined).toContain("DDD Mandate");
  });

  it("should warn about agent conflicts", () => {
    const ctx = {
      ...baseCtx,
      activeIntents: [
        { agentName: "Agent A", timestamp: "...", intent: "Working on auth", type: "CLI" },
        { agentName: "Agent B", timestamp: "...", intent: "Working on DB", type: "CLI" }
      ]
    };
    const refined = PromptRefiner.refine("Fix bugs", ctx, {});
    expect(refined).toContain("CROSS-AGENT CONFLICT WARNING");
    expect(refined).toContain("Agent A");
    expect(refined).toContain("Agent B");
  });

  it("should not treat prompt verbosity as quality gain", () => {
    const shortRefinement = PromptRefiner.calculateGain("task", "task with context", baseCtx);
    const verboseRefinement = PromptRefiner.calculateGain("task", `task ${"detail ".repeat(1000)}`, baseCtx);
    expect(verboseRefinement).toBe(shortRefinement);
  });

  it("should use selected approved templates as bounded refinement context", () => {
    const approvedTemplates = [{
      id: "feature-template",
      category: "feature",
      title: "Reviewed feature template",
      templateText: "Implement [FEATURE] using existing project patterns.",
      usageNotes: "Verify behavior with focused tests.",
      relevanceScore: 92,
      selectionReasons: ["category:feature"]
    }];

    const refined = PromptRefiner.refine("Create a login button", baseCtx, {}, undefined, { approvedTemplates });
    const gain = PromptRefiner.calculateGain("Create a login button", refined, baseCtx, { approvedTemplates });

    expect(refined).toContain("Approved Prompt Templates");
    expect(refined).toContain("Reviewed feature template");
    expect(refined).toContain("do not replace the user's intent");
    expect(gain).toBeGreaterThan(PromptRefiner.calculateGain("Create a login button", refined, baseCtx));
  });
});
