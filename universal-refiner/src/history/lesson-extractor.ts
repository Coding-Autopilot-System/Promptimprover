import { EventStore } from "./event-store.js";
import { RuntimeLogger } from "../core/logger.js";
import { parseStructuredResponse } from "../core/structured-response.js";

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
      WHERE l.id IS NULL AND e.status = 'completed'
    `).all();

    for (const pair of unanalyzedPairs) {
      await this.analyzePair(pair);
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
      const lessonData = parseStructuredResponse<{
        title: string;
        summary: string;
        lesson_type: string;
        confidence: string;
      }>(response);
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

  async extractFailureLessons() {
    const db = (this.eventStore as any).db;

    const unanalyzedFailures = db.prepare(`
      SELECT e.id as execution_id, p.id as prompt_id, p.raw_prompt, p.intent, e.result_summary, e.artifacts_json, p.repo_id
      FROM executions e
      JOIN prompts p ON e.prompt_id = p.id
      LEFT JOIN lessons l ON e.id = l.execution_id
      WHERE l.id IS NULL AND e.status = 'failed'
    `).all();

    for (const failure of unanalyzedFailures) {
      await this.analyzeFailure(failure);
    }
  }

  private async analyzeFailure(failure: any) {
    RuntimeLogger.info(`Analyzing AI failure for lesson: ${failure.prompt_id} -> ${failure.execution_id}`);

    const analysisPrompt = `
Act as a senior software engineering mentor. Analyze this failed AI operation and extract a reusable engineering lesson to avoid this failure in the future.

USER PROMPT:
"${failure.raw_prompt}"

ERROR OR RESULT SUMMARY:
${failure.result_summary}

ARTIFACTS / ADDITIONAL CONTEXT:
${failure.artifacts_json}

Identify:
1. What did the user want?
2. What went wrong based on the error output?
3. What is the reusable "lesson" or mandate here for future prompts? (e.g., "When implementing feature X, do not use Y", or "Always verify Z before execution").

Output a JSON object:
{
  "title": "Short descriptive title",
  "summary": "The reusable lesson/mandate to prevent this error",
  "lesson_type": "architecture | security | quality | convention",
  "confidence": "high | medium | low"
}

Output ONLY the JSON object.
`;

    const response = await this.requestModelText("Failure analysis", analysisPrompt, 1000);
    if (!response) return;

    try {
      const lessonData = parseStructuredResponse<{
        title: string;
        summary: string;
        lesson_type: string;
        confidence: string;
      }>(response);
      const lessonId = `lsn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      this.eventStore.recordLesson({
        id: lessonId,
        repo_id: failure.repo_id,
        prompt_id: failure.prompt_id,
        execution_id: failure.execution_id,
        commit_id: undefined,
        lesson_type: lessonData.lesson_type,
        title: lessonData.title,
        summary: lessonData.summary,
        confidence: lessonData.confidence,
        source: "auto-extracted-failure"
      });

      this.eventStore.recordEvent({
        id: `evt_lsn_${Date.now()}`,
        event_type: "lesson_extracted",
        prompt_id: failure.prompt_id,
        execution_id: failure.execution_id,
        summary: `Extracted failure lesson: ${lessonData.title}`
      });

      RuntimeLogger.info(`Successfully extracted failure lesson: ${lessonData.title}`);
    } catch (error) {
      RuntimeLogger.error("Failed to parse extracted failure lesson JSON", error);
    }
  }
}
