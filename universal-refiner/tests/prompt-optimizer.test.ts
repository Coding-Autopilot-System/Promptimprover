import { describe, expect, it, vi } from "vitest";
import { PromptOptimizer } from "../src/refiners/prompt-optimizer.js";
import { ProjectContext } from "../src/detectors/project-scout.js";

const context: ProjectContext = {
  language: "TypeScript",
  framework: "Node.js",
  testing: "Vitest",
  isTypeScript: true,
  customMandates: ["Preserve behavior"],
  predictiveLessons: [{ summary: "Add regression tests" }],
  relevantSnippets: [{ filePath: "src/auth.ts", content: "export function login() {}", symbolName: "login", symbolType: "function" }],
};

describe("PromptOptimizer", () => {
  it("iteratively adopts rewritten prompts and passes project context to the model", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce("critique\n---REWRITTEN PROMPT---\nFirst rewrite")
      .mockResolvedValueOnce("critique\n---REWRITTEN PROMPT---\nFinal rewrite");

    await expect(new PromptOptimizer(request).optimize("Fix login", context, 2)).resolves.toBe("Final rewrite");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toContain("Preserve behavior");
    expect(request.mock.calls[0][1]).toContain("Add regression tests");
    expect(request.mock.calls[0][1]).toContain("src/auth.ts");
    expect(request.mock.calls[1][1]).toContain("First rewrite");
  });

  it("uses fallback response parsing and stops when the provider is unavailable", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce("Rewritten Prompt: Add tests and verify login")
      .mockResolvedValueOnce(null);

    await expect(new PromptOptimizer(request).optimize("Fix login", { ...context, relevantSnippets: undefined }, 3))
      .resolves.toBe("Rewritten Prompt: Add tests and verify login");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toContain("No relevant snippets found.");
  });
});
