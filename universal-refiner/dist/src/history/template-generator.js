import { EventStore } from "./event-store.js";
import { RuntimeLogger } from "../core/logger.js";
export class TemplateGenerator {
    eventStore;
    requestModelText;
    constructor(requestModelText) {
        this.eventStore = EventStore.getInstance();
        this.requestModelText = requestModelText;
    }
    /**
     * Generates new prompt templates based on successful historical outcomes.
     */
    async generateNewTemplates(repoId) {
        RuntimeLogger.info(`Starting Autonomous Template Generation for ${repoId}...`);
        // 1. Fetch successful "Linked Stories"
        const db = this.eventStore.db;
        const stories = db.prepare(`
      SELECT p.raw_prompt, p.normalized_prompt, e.result_summary, c.message as commit_msg, c.changed_files_json
      FROM prompts p
      JOIN executions e ON p.id = e.prompt_id
      JOIN execution_commits ec ON e.id = ec.execution_id
      JOIN commits c ON ec.commit_id = c.id
      WHERE e.status = 'completed' AND p.repo_id = ?
    `).all(repoId);
        if (stories.length < 2) {
            RuntimeLogger.info("Not enough successful history to generate templates yet.");
            return;
        }
        // 2. Synthesize templates via LLM
        const synthesisPrompt = `
Act as an expert Prompt Engineer. Analyze these successful historical prompt-to-code outcomes and synthesize 2-3 "Gold Standard" prompt templates.

HISTORICAL OUTCOMES:
${stories.map((s, i) => `
Outcome ${i + 1}:
- User Intent: ${s.raw_prompt}
- Code Summary: ${s.commit_msg}
- Files Changed: ${s.changed_files_json}
`).join("\n---\n")}

Your Goal:
Create reusable prompt templates that capture the patterns of success. Use placeholders like [INTENT], [TARGET_FILE], or [SPECIFICS].

Output a JSON array of templates:
{
  "templates": [
    {
      "name": "Short descriptive name",
      "description": "When to use this template",
      "category": "feature | bugfix | refactor | test",
      "template_text": "The actual reusable prompt text with [PLACEHOLDERS]",
      "usage_notes": "Specific advice for using this successfully",
      "success_score": 95
    }
  ]
}

Output ONLY the JSON object.
`;
        const response = await this.requestModelText("Template synthesis", synthesisPrompt, 2000);
        if (!response)
            return;
        try {
            const data = JSON.parse(response);
            for (const t of data.templates) {
                const templateId = `tpl_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                this.eventStore.recordTemplate({
                    id: templateId,
                    repo_id: repoId,
                    category: t.category,
                    title: t.name,
                    template_text: t.template_text,
                    usage_notes: t.usage_notes,
                    source_type: "autonomous-synthesis",
                    success_score: t.success_score
                });
                RuntimeLogger.info(`Successfully synthesized template: ${t.name}`);
            }
        }
        catch (error) {
            RuntimeLogger.error("Failed to parse template synthesis JSON", error);
        }
    }
}
