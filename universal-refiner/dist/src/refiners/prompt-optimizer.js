import { RuntimeLogger } from "../core/logger.js";
import { CommandCenterDashboard } from "../core/dashboard.js";
export class PromptOptimizer {
    requestModelText;
    constructor(requestModelText) {
        this.requestModelText = requestModelText;
    }
    /**
     * Iteratively optimizes a prompt using LLM critiques.
     */
    async optimize(originalPrompt, ctx, iterations = 2) {
        let currentPrompt = originalPrompt;
        CommandCenterDashboard.log(`Starting Automated Prompt Optimization (${iterations} iterations)...`);
        for (let i = 1; i <= iterations; i++) {
            RuntimeLogger.info(`Optimization Iteration ${i}/${iterations}`);
            CommandCenterDashboard.log(`Optimization Iteration ${i}...`);
            const critiquePrompt = `
Act as a strict, senior software architect reviewing a junior developer's prompt before it is sent to an AI coding agent.
Analyze the prompt against the project context and output an improved, highly specific version of the prompt.

PROJECT CONTEXT:
Framework: ${ctx.framework}
Language: ${ctx.language}
Mandates: ${JSON.stringify(ctx.customMandates || [])}
Lessons: ${JSON.stringify(ctx.predictiveLessons?.map((l) => l.summary) || [])}
Relevant Code Snippets:
${ctx.relevantSnippets?.map(s => `[File: ${s.filePath}] ${s.symbolName || "chunk"}:\n${s.content}`).join("\n---\n") || "No relevant snippets found."}

CURRENT PROMPT:
"${currentPrompt}"

Critique the prompt internally on these points:
1. Are there missing technical details (e.g., file paths, error handling, component structure)?
2. Does it violate any mandates or lessons?
3. Is it too vague for a deterministic AI outcome?

Then, provide the REWRITTEN PROMPT below a "---REWRITTEN PROMPT---" separator. 
The rewritten prompt must be self-contained, highly detailed, incorporate the rules/lessons explicitly, and be ready to be executed by an AI.
`;
            const response = await this.requestModelText(`Prompt Optimization Iteration ${i}`, critiquePrompt, 2000);
            if (!response) {
                RuntimeLogger.warn(`Optimization failed on iteration ${i} due to sampling error.`);
                break;
            }
            const parts = response.split("---REWRITTEN PROMPT---");
            if (parts.length > 1) {
                currentPrompt = parts[1].trim();
            }
            else {
                // Fallback if the LLM didn't use the exact separator
                currentPrompt = response.replace(/.*?(?=Here is the rewritten|Rewritten Prompt)/is, "").trim() || response.trim();
            }
        }
        CommandCenterDashboard.log(`Optimization Complete.`);
        return currentPrompt;
    }
}
