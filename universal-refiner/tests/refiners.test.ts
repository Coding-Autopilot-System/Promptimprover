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
});
