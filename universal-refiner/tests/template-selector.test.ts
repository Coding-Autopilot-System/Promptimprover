import { describe, expect, it } from "vitest";
import {
  ApprovedTemplateSelector,
  type ApprovedTemplateSource,
  type PromptTemplateCandidate
} from "../src/refiners/template-selector.js";

describe("ApprovedTemplateSelector", () => {
  const templates: PromptTemplateCandidate[] = [
    {
      id: "feature",
      repoId: "repo",
      category: "feature",
      title: "Feature implementation",
      templateText: "Implement [FEATURE] and verify it.",
      usageNotes: "Use for new features.",
      successScore: 90,
      approved: 1
    },
    {
      id: "bugfix",
      repoId: "repo",
      category: "bugfix",
      title: "Bug fix",
      templateText: "Reproduce and fix [BUG].",
      successScore: 75,
      approved: true
    },
    {
      id: "pending",
      repoId: "repo",
      category: "feature",
      title: "Pending",
      templateText: "Do not select.",
      successScore: 100,
      approved: 0
    },
    {
      id: "deprecated",
      repoId: "repo",
      category: "feature",
      title: "Deprecated",
      templateText: "Do not select.",
      successScore: 100,
      approved: 1,
      deprecated: 1
    }
  ];

  const source: ApprovedTemplateSource = {
    getTemplates: () => templates
  };

  it("retrieves only approved, active templates and ranks prompt relevance", async () => {
    const selected = await new ApprovedTemplateSelector(source).select({
      repoId: "repo",
      prompt: "Implement a new login feature",
      limit: 2
    });

    expect(selected.map(template => template.id)).toEqual(["feature", "bugfix"]);
    expect(selected[0].selectionReasons).toContain("category:feature");
    expect(selected.some(template => template.id === "pending")).toBe(false);
    expect(selected.some(template => template.id === "deprecated")).toBe(false);
  });

  it("keeps repository boundaries", async () => {
    const selected = await new ApprovedTemplateSelector(source).select({
      repoId: "other",
      prompt: "Implement a feature"
    });

    expect(selected).toEqual([]);
  });

  it("supports a disabled selection limit without querying the source", async () => {
    let queried = false;
    const selector = new ApprovedTemplateSelector({
      getTemplates: () => {
        queried = true;
        return templates;
      }
    });

    expect(await selector.select({ repoId: "repo", prompt: "Implement a feature", limit: 0 })).toEqual([]);
    expect(queried).toBe(false);
  });
});
