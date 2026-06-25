import { EventStore } from "../history/event-store.js";
import { RuntimeLogger } from "../core/logger.js";
import { createABEvaluationRecord } from "../evaluation/prompt-evaluator.js";
import { randomUUID } from "crypto";

export class TokenMinifier {
  private requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>;

  constructor(
    requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  ) {
    this.requestModelText = requestModelText;
  }

  public async minifyVerbosePrompts(): Promise<number> {
    const store = EventStore.getInstance();
    const prompts = store.getLatestPrompts();
    let minifiedCount = 0;

    for (const prompt of prompts) {
      if (prompt.raw_prompt.length < 300) {
        continue;
      }

      // Check if this exact prompt has already been minified/templated
      if (!prompt.repo_id) {
        continue;
      }

      const existingTemplates = store.getTemplatesForPrompt(prompt.repo_id, prompt.raw_prompt);
      if (existingTemplates && existingTemplates.length > 0) {
        continue;
      }

      const taskName = "TokenMinifier";
      const requestStr = `Compress the following prompt to be as short and token-efficient as possible without losing any technical requirements, action verbs, or constraints. Return ONLY the minified prompt.\n\nPrompt:\n${prompt.raw_prompt}`;

      const minified = await this.requestModelText(taskName, requestStr, 1024);
      if (!minified || minified.trim() === "") {
        continue;
      }

      // Ensure the minified version is actually shorter
      if (minified.length >= prompt.raw_prompt.length) {
        continue;
      }

      const experiment = createABEvaluationRecord({
        experimentId: `min_${randomUUID()}`,
        baselinePrompt: prompt.raw_prompt,
        variantA: { id: "minified", prompt: minified },
        variantB: { id: "original", prompt: prompt.raw_prompt }
      });

      // If the minified version is preferred or tied (often due to higher density), save it
      if (experiment.heuristicPreference === "A" || experiment.heuristicPreference === "tie") {
        store.recordTemplate({
          id: `tpl_${randomUUID()}`,
          repo_id: prompt.repo_id,
          cluster_id: undefined,
          category: "Minified",
          title: "Auto-Minified Prompt",
          template_text: minified,
          usage_notes: "^" + this.escapeRegExp(prompt.raw_prompt) + "$",
          source_type: "auto",
          success_score: experiment.variantA.evaluation.heuristicScore,
          approved: 0,
          deprecated: 0
        });
        minifiedCount++;
        RuntimeLogger.info("Created pending auto-minified prompt template", { originalLength: prompt.raw_prompt.length, newLength: minified.length });
      }
    }

    return minifiedCount;
  }

  private escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
