import { EventStore } from "./event-store.js";
import { RuntimeLogger } from "../core/logger.js";

export class LessonExtractor {
  private eventStore: EventStore;
  private requestModelText: (taskName: string, prompt: string, maxTokens: number) => Promise<string | null>;

  constructor(requestModelText: (taskName: string, prompt: string, maxTokens: number) => Promise<string | null>) {
    this.eventStore = EventStore.getInstance();
    this.requestModelText = requestModelText;
  }

  async extractNewLessons() {
    const db = (this.eventStore as any).db;
    
    // 1. Find linked prompt-commit pairs that don't have a lesson yet
    const unanalyzedPairs = db.prepare(`
      SELECT p.id as prompt_id, p.raw_prompt, p.intent, c.id as commit_id, c.message, c.changed_files_json, c.repo_id, e.id as execution_id
      FROM prompts p
      JOIN executions e ON p.id = e.prompt_id
      JOIN execution_commits ec ON e.id = ec.execution_id
      JOIN commits c ON ec.commit_id = c.id
      LEFT JOIN lessons l ON p.id = l.prompt_id AND c.id = l.commit_id
      WHERE l.id IS NULL
    `).all();

    for (const pair of unanalyzedPairs) {
      await this.analyzePair(pair);
    }

    // 2. Also analyze successful executions that might not be linked to commits yet
    const standaloneExecutions = db.prepare(`
      SELECT p.id as prompt_id, p.raw_prompt, p.normalized_prompt, e.id as execution_id, e.result_summary, p.repo_id
      FROM prompts p
      JOIN executions e ON p.id = e.prompt_id
      LEFT JOIN lessons l ON p.id = l.prompt_id
      WHERE e.status = 'completed' 
      AND l.id IS NULL
      LIMIT 10
    `).all();

    for (const exec of standaloneExecutions) {
      await this.analyzeExecution(exec);
    }
  }

  private async analyzeExecution(exec: any) {
    RuntimeLogger.info(`Analyzing Successful Execution for lesson: ${exec.execution_id}`);

    const analysisPrompt = `
Act as a senior software architect. Analyze this successful prompt execution and extract a reusable "Engineering Mandate" for future prompts in this project.

USER PROMPT:
"${exec.raw_prompt}"

REFINED PROMPT:
"${exec.normalized_prompt || "N/A"}"

EXECUTION SUMMARY:
"${exec.result_summary || "Task completed successfully."}"

What is the reusable "lesson" here? (e.g., "When using framework X, ensure the prompt specifies Y for proper Z").

Output a JSON object:
{
  "title": "Short descriptive title",
  "summary": "The reusable engineering mandate",
  "lesson_type": "architecture | security | quality | convention",
  "confidence": "high | medium | low"
}

Output ONLY the JSON object.
`;

    const response = await this.requestModelText("Execution lesson extraction", analysisPrompt, 1000);
    if (!response) return;

    try {
      const lessonData = JSON.parse(response);
      const lessonId = `lsn_exec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      this.eventStore.recordLesson({
        id: lessonId,
        repo_id: exec.repo_id,
        prompt_id: exec.prompt_id,
        execution_id: exec.execution_id,
        lesson_type: lessonData.lesson_type,
        title: lessonData.title,
        summary: lessonData.summary,
        confidence: lessonData.confidence,
        source: "execution-analysis"
      });

      RuntimeLogger.info(`Successfully extracted execution lesson: ${lessonData.title}`);
    } catch (error) {
      RuntimeLogger.error("Failed to parse execution lesson JSON", error);
    }
  }

  private async analyzePair(pair: any) {
    RuntimeLogger.info(`Analyzing Prompt -> Commit for lesson: ${pair.prompt_id} -> ${pair.commit_id}`);

    const analysisPrompt = `
Act as a senior software engineering mentor. Analyze this "linked story" and extract a reusable engineering lesson or best practice.

USER PROMPT:
"${pair.raw_prompt}"

RESULTING GIT COMMIT:
Message: ${pair.message}
Files Changed: ${pair.changed_files_json}

Identify:
1. What did the user want?
2. What did the developer actually do in the code?
3. What is the reusable "lesson" here for future prompts? (e.g., "When implementing feature X, always ensure Y is included in the prompt to avoid Z").

Output a JSON object:
{
  "title": "Short descriptive title",
  "summary": "The reusable lesson/mandate",
  "lesson_type": "architecture | security | quality | convention",
  "confidence": "high | medium | low"
}

Output ONLY the JSON object.
`;

    const response = await this.requestModelText("Lesson extraction", analysisPrompt, 1000);
    if (!response) return;

    try {
      const lessonData = JSON.parse(response);
      const lessonId = `lsn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      this.eventStore.recordLesson({
        id: lessonId,
        repo_id: pair.repo_id,
        prompt_id: pair.prompt_id,
        execution_id: pair.execution_id,
        commit_id: pair.commit_id,
        lesson_type: lessonData.lesson_type,
        title: lessonData.title,
        summary: lessonData.summary,
        confidence: lessonData.confidence,
        source: "auto-extracted"
      });

      this.eventStore.recordEvent({
        id: `evt_lsn_${Date.now()}`,
        event_type: "lesson_extracted",
        prompt_id: pair.prompt_id,
        commit_id: pair.commit_id,
        summary: `Extracted predictive lesson: ${lessonData.title}`
      });

      RuntimeLogger.info(`Successfully extracted lesson: ${lessonData.title}`);
    } catch (error) {
      RuntimeLogger.error("Failed to parse extracted lesson JSON", error);
    }
  }
}
