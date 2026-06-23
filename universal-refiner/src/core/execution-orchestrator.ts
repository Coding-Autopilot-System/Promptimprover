import { EventStore } from "../history/event-store.js";
import { randomUUID } from "crypto";
import { RuntimeLogger } from "./logger.js";
import { CommandCenterDashboard } from "./dashboard.js";
import { AutoPilotStatus } from "./autopilot-status.js";

const MAX_HEALING_RETRIES = 2;
const MAX_STORED_MODEL_RESPONSE_LENGTH = 8_000;

export class ExecutionOrchestrator {
  constructor(
    private eventStore: EventStore, 
    private requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  ) {}

  async healAndRetry(executionId: string, lessonId: string): Promise<boolean> {
    const execution = this.eventStore.getExecutionById(executionId);
    if (!execution) {
      RuntimeLogger.warn(`Execution ${executionId} not found for healing.`);
      return false;
    }

    const lesson = this.eventStore.getLessonById(lessonId);
    if (!lesson) {
      RuntimeLogger.warn(`Lesson ${lessonId} not found for healing.`);
      return false;
    }
    if (lesson.approved !== 1 || lesson.execution_id !== executionId) {
      RuntimeLogger.warn(`Lesson ${lessonId} is not approved for execution ${executionId}.`);
      return false;
    }

    // Fetch the original prompt
    const prompt = this.eventStore.getPromptById(execution.prompt_id);
    if (!prompt) {
      RuntimeLogger.warn(`Original prompt not found for execution ${executionId}.`);
      return false;
    }

    const retryCount = this.eventStore.countSelfHealingAttempts(executionId);
    if (retryCount >= MAX_HEALING_RETRIES) {
      RuntimeLogger.warn(`Max retries (${MAX_HEALING_RETRIES}) reached for execution ${executionId}.`);
      return false;
    }

    CommandCenterDashboard.log(`[Auto-Heal] Retrying execution ${executionId} using lesson: ${lesson.title}`);

    // Create the healed prompt structure
    const healedPromptContent = `[HEALING: ${executionId}]\nThe previous execution of this prompt failed.
    
Original Request:
${prompt.raw_prompt}

Extracted Lesson to Apply:
Title: ${lesson.title}
Rule: ${lesson.summary}

Please re-execute the original request while strictly adhering to the lesson above to avoid the previous failure.`;

    const newPromptId = `prm_heal_${randomUUID()}`;
    
    this.eventStore.recordPrompt({
      id: newPromptId,
      client: "Auto-Heal",
      agent_name: "ExecutionOrchestrator",
      raw_prompt: healedPromptContent,
      intent: "self-heal",
      repo_id: prompt.repo_id,
    });

    const newExecId = `exec_heal_${randomUUID()}`;
    const now = new Date().toISOString();
    
    this.eventStore.recordExecution({
      id: newExecId,
      prompt_id: newPromptId,
      workflow_name: "self-healing",
      executor_name: "ExecutionOrchestrator",
      status: "running",
      started_at: now,
    });

    try {
      const responseText = await this.requestModelText(
        "self_heal",
        healedPromptContent,
        4000
      );

      if (!responseText) {
        throw new Error("Semantic provider returned null response.");
      }

      this.eventStore.updateExecution({
        id: newExecId,
        status: "completed",
        ended_at: new Date().toISOString(),
        result_summary: `Healed execution succeeded.`,
        artifacts_json: JSON.stringify({ healedResponse: truncateForStorage(responseText) })
      });
      
      AutoPilotStatus.record(`Healed execution ${executionId} successfully.`, "cycle_complete");
      CommandCenterDashboard.log(`[Auto-Heal] Healed execution ${newExecId} succeeded.`);
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.eventStore.updateExecution({
        id: newExecId,
        status: "failed",
        ended_at: new Date().toISOString(),
        result_summary: `Healed execution failed: ${errorMessage}`,
      });
      AutoPilotStatus.record(`Healed execution ${executionId} failed: ${errorMessage}`, "error");
      CommandCenterDashboard.log(`[Auto-Heal] Healed execution ${newExecId} failed again.`);
      return false;
    }
  }
}

function truncateForStorage(value: string): string {
  if (value.length <= MAX_STORED_MODEL_RESPONSE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STORED_MODEL_RESPONSE_LENGTH)}... [truncated]`;
}
