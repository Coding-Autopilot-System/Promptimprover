import { describe, it, expect } from "vitest";
import { PromptLinter } from "../src/linters/prompt-linter.js";
import { ProjectContext } from "../src/detectors/project-scout.js";

describe("PromptLinter", () => {
  const mockCtx: ProjectContext = {
    language: "TypeScript",
    framework: "React",
    testing: "Vitest",
    isTypeScript: true,
    architecturalPatterns: ["Modern Component-Based Architecture (React/Vue style)"],
    learnedPatterns: [],
    relevantSnippets: [],
    activeIntents: []
  };

  it("should detect missing testing strategy if not mentioned in prompt", () => {
    const prompt = "Build a user login system";
    const gaps = PromptLinter.lint(prompt, mockCtx);
    expect(gaps.some(g => g.id === "testing")).toBe(true);
  });

  it("should NOT detect testing gap if prompt mentions tests", () => {
    const prompt = "Build a login system with unit tests";
    const gaps = PromptLinter.lint(prompt, mockCtx);
    expect(gaps.some(g => g.id === "testing")).toBe(false);
  });

  it("should detect missing security requirements for data-sensitive prompts", () => {
    const prompt = "Create a database connection and user registration";
    const gaps = PromptLinter.lint(prompt, mockCtx);
    expect(gaps.some(g => g.id === "security")).toBe(true);
  });

  it("should detect missing architectural guidance for complex features", () => {
    const prompt = "Refactor the entire auth system";
    const gaps = PromptLinter.lint(prompt, mockCtx);
    expect(gaps.some(g => g.id === "architecture")).toBe(true);
  });

  it("should detect missing documentation requirements", () => {
    const prompt = "Create a new API endpoint";
    const gaps = PromptLinter.lint(prompt, mockCtx);
    expect(gaps.some(g => g.id === "documentation")).toBe(true);
  });
});
