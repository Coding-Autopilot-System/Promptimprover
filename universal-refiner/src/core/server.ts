import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as path from "path";
import { NodeDetector, PythonDetector, ProjectContext, ArchitecturalScout } from "../detectors/project-scout.js";
import { PromptLinter } from "../linters/prompt-linter.js";
import { PromptRefiner } from "../refiners/prompt-refiner.js";
import { LocalBrain } from "../memory/local-brain.js";
import { NeuralSnippets } from "../memory/neural-snippets.js";
import { AgenticBlackboard } from "./blackboard.js";
import { CommandCenterDashboard } from "./dashboard.js";
import { ConfigManager } from "./config.js";
import { RuntimeLogger } from "./logger.js";
import { EventStore } from "../history/event-store.js";
import { getDisplayVersion, getPackageVersion } from "./version.js";

import { CommitIngester } from "../history/commit-ingest.js";
import { LessonExtractor } from "../history/lesson-extractor.js";
import { CorrelationEngine } from "../history/correlation-engine.js";
import { PromptOptimizer } from "../refiners/prompt-optimizer.js";
import { TemplateGenerator } from "../history/template-generator.js";
import { BackgroundAutonomyService } from "./background-service.js";
import {
  LocalOpenAiProvider,
  McpSamplingProvider,
  SemanticProvider,
  SemanticProviderChain,
  SemanticResponse,
} from "./semantic-provider.js";
import { parseStructuredResponse } from "./structured-response.js";
import { RepositoryIdentity } from "../history/repository-identity.js";
import { ApprovedTemplateSelector } from "../refiners/template-selector.js";
import { createABEvaluationRecord, evaluatePrompt } from "../evaluation/prompt-evaluator.js";
import { randomUUID } from "node:crypto";

export class PromptRefinerServer {
  private server: Server;
  private rootPath: string;
  private samplingUnavailableReason: string | null = null;
  private eventStore: EventStore;
  private backgroundAutonomy: BackgroundAutonomyService | null = null;
  private semanticProviders: SemanticProviderChain;
  private repository: RepositoryIdentity;
  private templateSelector: ApprovedTemplateSelector;
  private running = false;

  constructor(rootPath: string = ".") {
    this.rootPath = rootPath;
    this.eventStore = EventStore.getInstance();
    this.repository = this.eventStore.ensureRepository(rootPath);
    this.templateSelector = new ApprovedTemplateSelector(this.eventStore);
    this.server = new Server(
      { name: "prompt-refiner", version: getPackageVersion() },
      { capabilities: { tools: {}, logging: {}, experimental: { sampling: {} } } }
    );
    this.semanticProviders = this.createSemanticProviderChain();
    this.setupToolHandlers();
  }

  private createSemanticProviderChain(): SemanticProviderChain {
    const config = ConfigManager.getSemanticConfig(this.rootPath);
    const providers: SemanticProvider[] = [];

    if (config.localEnabled) {
      try {
        providers.push(new LocalOpenAiProvider(config));
      } catch (error) {
        RuntimeLogger.warn("Local semantic provider configuration rejected", {
          error: String(error),
        });
      }
    }
    if (config.mcpSamplingEnabled) {
      providers.push(new McpSamplingProvider(this.requestMcpSamplingText.bind(this)));
    }

    return new SemanticProviderChain(providers, this.recordSemanticSuccess.bind(this));
  }

  private recordSemanticSuccess(response: SemanticResponse, request: { taskName: string }) {
    const details = {
      taskName: request.taskName,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      fallbackFrom: response.fallbackFrom,
    };
    RuntimeLogger.info(`${request.taskName} semantic request completed`, details);
    this.eventStore.recordEvent({
      id: `evt_semantic_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      event_type: "semantic_request_completed",
      repo_id: this.repository.id,
      summary: `${request.taskName} completed with ${response.provider}/${response.model}`,
      details_json: JSON.stringify(details),
    });
    CommandCenterDashboard.log(`${request.taskName}: ${response.provider}/${response.model} in ${response.latencyMs}ms`);
  }

  private async scoutProject(query?: string): Promise<ProjectContext> {
    const nodeCtx = await NodeDetector.detect(this.rootPath);
    const pyCtx = await PythonDetector.detect(this.rootPath);
    const patterns = await ArchitecturalScout.detectPatterns(this.rootPath);
    const learned = LocalBrain.getPatterns(this.rootPath);
    const config = ConfigManager.loadConfig(this.rootPath);
    const predictive = ConfigManager.getPredictiveMandates();
    const snippets = query ? await NeuralSnippets.search(query, this.rootPath) : [];
    const activeIntents = AgenticBlackboard.getActiveIntents(this.rootPath);
    const repoId = this.repository.id;
    const predictiveLessons = this.eventStore.getRecentLessons(repoId, 5);

    return {
      language: nodeCtx.language || pyCtx.language || "Unknown",
      framework: nodeCtx.framework || pyCtx.framework || "Unknown",
      testing: nodeCtx.testing || pyCtx.testing || "Unknown",
      orm: nodeCtx.orm || pyCtx.orm,
      styling: nodeCtx.styling,
      cloud: nodeCtx.cloud,
      isTypeScript: nodeCtx.isTypeScript || false,
      packageManager: nodeCtx.packageManager,
      scripts: nodeCtx.scripts,
      architecturalPatterns: patterns,
      learnedPatterns: learned,
      relevantSnippets: snippets,
      activeIntents,
      customMandates: [...(config.mandates || []), ...predictive],
      predictiveLessons
    };
  }

  private isSamplingUnsupportedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Method not found") || message.includes("-32601");
  }

  private disableSampling(reason: string, error: unknown) {
    if (this.samplingUnavailableReason) {
      return;
    }

    this.samplingUnavailableReason = reason;
    RuntimeLogger.warn("MCP sampling is unavailable; semantic features will fall back to local-only behavior", {
      rootPath: this.rootPath,
      reason,
      error: String(error),
    });
    CommandCenterDashboard.log(`Semantic Intelligence unavailable: ${reason}`);
  }

  private async requestMcpSamplingText(userPrompt: string, maxTokens: number): Promise<string | null> {
    if (this.samplingUnavailableReason) {
      return null;
    }

    try {
      const result = await this.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: userPrompt,
            }
          }
        ],
        maxTokens,
      });

      return result.content.type === "text" ? result.content.text : null;
    } catch (error) {
      if (this.isSamplingUnsupportedError(error)) {
        this.disableSampling("Client/runtime does not implement MCP sampling/createMessage.", error);
        return null;
      }

      RuntimeLogger.warn(`MCP sampling request failed`, {
        rootPath: this.rootPath,
        error: String(error),
      });
      return null;
    }
  }

  public async requestModelText(taskName: string, userPrompt: string, maxTokens: number): Promise<string | null> {
    return this.semanticProviders.requestText({ taskName, prompt: userPrompt, maxTokens });
  }

  private async lintSemantic(prompt: string, ctx: ProjectContext): Promise<any[]> {
    CommandCenterDashboard.log(`Executing Semantic Intelligence Analysis...`);
    const responseText = await this.requestModelText(
      "Semantic analysis",
      `Act as a senior software architect. Analyze this user prompt in the context of the current project and identify "semantic gaps" where the prompt is vague, misaligned with the tech stack, or missing critical engineering details.

Project Context: ${JSON.stringify(ctx)}
User Prompt: "${prompt}"

Output a JSON array of "gaps". Each gap must have:
- 'id': a short unique slug (e.g., 'stack-mismatch')
- 'message': a clear description of the gap
- 'suggestedAction': what the user should specify to fix it.

Output ONLY the JSON array. If no gaps, return [].`,
      1000,
    );

    if (!responseText) {
      CommandCenterDashboard.log(`Semantic Analysis skipped; using rule-based linting only.`);
      return [];
    }

    try {
      return parseStructuredResponse<any[]>(responseText);
    } catch (error) {
      RuntimeLogger.warn("Semantic analysis returned invalid JSON", {
        rootPath: this.rootPath,
        promptPreview: prompt.substring(0, 120),
        responsePreview: responseText.substring(0, 300),
        error: String(error),
      });
      CommandCenterDashboard.log(`Semantic Analysis returned invalid JSON.`);
      return [];
    }
  }

  private getAgentName(request: any): string {
    return (request.params as any)?._meta?.progressToken ||
           (request.params as any)?._meta?.agentName ||
           "User CLI";
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "lint_prompt",
          description: "Performs modular analysis of a prompt and codebase.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              semantic: { type: "boolean", description: "Set false for latency-sensitive automation that needs rule-based linting only." }
            },
            required: ["prompt"],
          },
        },
        {
          name: "create_questions",
          description: "Generates clarifying questions for identified gaps.",
          inputSchema: {
            type: "object",
            properties: { gaps: { type: "array", items: { type: "object" } } },
            required: ["gaps"],
          },
        },
        {
          name: "finalize_prompt",
          description: "Refines the prompt using SRP, SOLID, and Learned Patterns.",
          inputSchema: {
            type: "object",
            properties: {
              original_prompt: { type: "string" },
              answers: { type: "object" },
            },
            required: ["original_prompt", "answers"],
          },
        },
        {
          name: "proactive_suggest",
          description: "Uses Sampling (LLM-to-LLM) to suggest a technical implementation plan.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
            },
            required: ["prompt"],
          },
        },
        {
          name: "generate_agent_onboarding",
          description: "Generates an AGENTS.md file tailored to the detected project context.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "discover_rules",
          description: "Autonomously analyzes the project context and proposes new engineering mandates.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "approve_rule",
          description: "Promotes an AI-proposed rule to an active project mandate.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "The ID of the rule to approve." } },
            required: ["id"]
          }
        },
        {
          name: "list_learning_candidates",
          description: "Lists review-gated lesson and prompt-template candidates for the current repository.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "record_terminal_outcome",
          description: "Records one evidence-backed terminal goal outcome and an optional review-gated lesson candidate.",
          inputSchema: {
            type: "object",
            properties: {
              goal_id: { type: "string" },
              status: { type: "string", enum: ["completed", "failed", "cancelled", "blocked", "budget_exhausted"] },
              evidence: { type: "array", items: { type: "string" }, minItems: 1 },
              summary: { type: "string" }
            },
            required: ["goal_id", "status", "evidence", "summary"]
          }
        },
        {
          name: "review_lesson",
          description: "Approves or rejects a proposed lesson before it can influence future prompts.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              approved: { type: "boolean" }
            },
            required: ["id", "approved"]
          }
        },
        {
          name: "review_template",
          description: "Approves or rejects a proposed prompt template.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              approved: { type: "boolean" }
            },
            required: ["id", "approved"]
          }
        },
        {
          name: "ingest_pattern",
          description: "Saves a learned engineering pattern to the project's persistent memory.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique ID for the pattern (e.g., 'jwt-auth')" },
              category: { type: "string", description: "Category (e.g., 'security', 'architecture')" },
              description: { type: "string", description: "Detailed description of the pattern" },
            },
            required: ["id", "category", "description"],
          },
        },
        {
          name: "ingest_commits",
          description: "Ingests recent git commits to update project history and learning state.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Number of recent commits to ingest (default 10)." }
            }
          }
        },
        {
          name: "derive_lessons",
          description: "Analyzes recent history to extract predictive engineering lessons.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "correlate_history",
          description: "Correlates unlinked commits with prompts using time and semantic scoring.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "optimize_prompt",
          description: "Automatically critiques and improves a draft prompt iteratively based on project context.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              iterations: { type: "number", description: "Number of LLM critique cycles (default 2)." }
            },
            required: ["prompt"]
          }
        },
        {
          name: "generate_templates",
          description: "Autonomously synthesizes reusable prompt templates from successful project history.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "record_agent_output",
          description: "Records the final output or result summary of an agent's execution of a prompt.",
          inputSchema: {
            type: "object",
            properties: {
              prompt_id: { type: "string", description: "The tracking ID found in the refined prompt (e.g., 'ref_123...')" },
              output_summary: { type: "string", description: "A concise summary of what was achieved or the final response text." },
              artifacts_json: { type: "string", description: "Optional: JSON string of any artifacts created (files, links, etc.)." },
              status: { type: "string", enum: ["completed", "failed"], description: "Verified execution outcome. Defaults to completed." }
            },
            required: ["prompt_id", "output_summary"]
          }
        },
        {
          name: "evaluate_prompt",
          description: "Scores a prompt with deterministic evidence indicators across five quality dimensions.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              baseline_prompt: { type: "string", description: "Optional original prompt used to measure intent preservation." }
            },
            required: ["prompt"]
          }
        },
        {
          name: "compare_prompt_variants",
          description: "Compares prompt variants and separates heuristic preference from optional observed execution evidence.",
          inputSchema: {
            type: "object",
            properties: {
              baseline_prompt: { type: "string" },
              variant_a: { type: "string" },
              variant_b: { type: "string" },
              outcome_a: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["completed", "failed", "cancelled"] },
                  testsPassed: { type: "number" },
                  testsFailed: { type: "number" },
                  reworkCount: { type: "number" }
                },
                required: ["status"]
              },
              outcome_b: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["completed", "failed", "cancelled"] },
                  testsPassed: { type: "number" },
                  testsFailed: { type: "number" },
                  reworkCount: { type: "number" }
                },
                required: ["status"]
              }
            },
            required: ["baseline_prompt", "variant_a", "variant_b"]
          }
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        CommandCenterDashboard.log(`MCP Call: ${request.params.name}`);
        const agentName = this.getAgentName(request);

        switch (request.params.name) {
          case "lint_prompt": {
            const { prompt, semantic } = z.object({
              prompt: z.string(),
              semantic: z.boolean().optional(),
            }).parse(request.params.arguments);
            AgenticBlackboard.postIntent(agentName, "lint", prompt, this.rootPath);
            CommandCenterDashboard.log(`Scouting project for prompt: "${prompt.substring(0, 30)}..."`);

            const promptId = `prm_${randomUUID()}`;
            this.eventStore.recordPrompt({
              id: promptId,
              client: "MCP",
              agent_name: agentName,
              raw_prompt: prompt,
              repo_id: this.repository.id
            });

            const ctx = await this.scoutProject(prompt);
            const ruleGaps = PromptLinter.lint(prompt, ctx);
            const semanticGaps = semantic === false ? [] : await this.lintSemantic(prompt, ctx);
            const gaps = PromptLinter.mergeGaps(ruleGaps, semanticGaps);

            CommandCenterDashboard.log(`Found ${gaps.length} total gaps (Rule: ${ruleGaps.length}, Semantic: ${semanticGaps.length}).`);
            return { content: [{ type: "text", text: JSON.stringify({ promptId, gaps, context: ctx }) }] };
          }
          case "create_questions": {
            const { gaps } = z.object({ gaps: z.array(z.any()) }).parse(request.params.arguments);
            const questions = gaps.map((gap: any) => ({
              header: "Refinement",
              question: gap.message + " " + gap.suggestedAction,
              type: "text"
            }));
            return { content: [{ type: "text", text: JSON.stringify(questions) }] };
          }
          case "finalize_prompt": {
            const { original_prompt, answers } = z.object({
              original_prompt: z.string(),
              answers: z.record(z.string(), z.any()),
            }).parse(request.params.arguments);
            AgenticBlackboard.postIntent(agentName, "finalize", original_prompt, this.rootPath);

            const ctx = await this.scoutProject(original_prompt);
            const promptId = `ref_${randomUUID()}`;
            const approvedTemplates = await this.templateSelector.select({
              repoId: this.repository.id,
              prompt: original_prompt,
            });
            const refinementContext = { approvedTemplates };
            const refined = PromptRefiner.refine(original_prompt, ctx, answers, promptId, refinementContext);
            const gain = PromptRefiner.calculateGain(original_prompt, refined, ctx, refinementContext);

            this.eventStore.recordPrompt({
              id: promptId,
              client: "MCP",
              agent_name: agentName,
              raw_prompt: original_prompt,
              normalized_prompt: refined,
              intent: "refine",
              repo_id: this.repository.id
            });

            CommandCenterDashboard.setLastRefinement(original_prompt, refined, this.rootPath, gain);
            CommandCenterDashboard.log(`Refinement Complete. Quality Gain: ${gain}%. Injected ${ctx.learnedPatterns?.length || 0} mandates and ${approvedTemplates.length} approved templates.`);

            return { content: [{ type: "text", text: refined }] };
          }
          case "discover_rules": {
            const ctx = await this.scoutProject();
            CommandCenterDashboard.log(`Executing Autonomous Rule Discovery...`);
            const responseText = await this.requestModelText(
              "Rule discovery",
              "Analyze this project context: " + JSON.stringify(ctx) + ". Propose 3 high-quality engineering mandates (rules) that would improve this specific codebase. Format each as a JSON object with 'id', 'category', and 'description'. Output ONLY the JSON array.",
              1000,
            );

            if (!responseText) {
              return { content: [{ type: "text", text: "Discovery unavailable because MCP sampling is not supported by the current client/runtime." }] };
            }

            try {
              const proposals = parseStructuredResponse<Array<{ id: string; category: string; description: string }>>(responseText);
              for (const p of proposals) {
                LocalBrain.savePattern({ ...p, isProposed: true }, this.rootPath);
              }
              CommandCenterDashboard.log(`Discovered ${proposals.length} new potential rules.`);
              return { content: [{ type: "text", text: "Successfully discovered and proposed " + proposals.length + " new rules." }] };
            } catch (error) {
              RuntimeLogger.error("Failed to parse discover_rules response", error);
              return { content: [{ type: "text", text: "Discovery failed to parse." }] };
            }
          }
          case "approve_rule": {
            const { id } = z.object({ id: z.string() }).parse(request.params.arguments);
            LocalBrain.approvePattern(id, this.rootPath);
            CommandCenterDashboard.log(`Rule Approved: ${id}`);
            return { content: [{ type: "text", text: "Rule '" + id + "' promoted!" }] };
          }
          case "list_learning_candidates": {
            const candidates = this.eventStore.getLearningCandidates(this.repository.id);
            return { content: [{ type: "text", text: JSON.stringify(candidates) }] };
          }
          case "record_terminal_outcome": {
            const outcome = z.object({
              goal_id: z.string().min(1),
              status: z.enum(["completed", "failed", "cancelled", "blocked", "budget_exhausted"]),
              evidence: z.array(z.string().min(1)).min(1),
              summary: z.string().min(1),
            }).parse(request.params.arguments);
            const recorded = this.eventStore.recordTerminalOutcome({
              ...outcome,
              repo_id: this.repository.id,
            });
            return { content: [{ type: "text", text: JSON.stringify({ recorded, goal_id: outcome.goal_id }) }] };
          }
          case "review_lesson": {
            const { id, approved } = z.object({ id: z.string(), approved: z.boolean() }).parse(request.params.arguments);
            const changed = this.eventStore.reviewLesson(this.repository.id, id, approved);
            if (!changed) {
              throw new McpError(ErrorCode.InvalidParams, `Pending lesson not found: ${id}`);
            }
            CommandCenterDashboard.log(`Lesson ${approved ? "approved" : "rejected"}: ${id}`);
            return { content: [{ type: "text", text: `Lesson ${id} ${approved ? "approved" : "rejected"}.` }] };
          }
          case "review_template": {
            const { id, approved } = z.object({ id: z.string(), approved: z.boolean() }).parse(request.params.arguments);
            const changed = this.eventStore.reviewTemplate(this.repository.id, id, approved);
            if (!changed) {
              throw new McpError(ErrorCode.InvalidParams, `Pending template not found: ${id}`);
            }
            CommandCenterDashboard.log(`Template ${approved ? "approved" : "rejected"}: ${id}`);
            return { content: [{ type: "text", text: `Template ${id} ${approved ? "approved" : "rejected"}.` }] };
          }
          case "ingest_pattern": {
            const args = z.object({
              id: z.string(),
              category: z.string(),
              description: z.string(),
            }).parse(request.params.arguments);

            const pattern = LocalBrain.savePattern(args, this.rootPath);
            CommandCenterDashboard.log(`Pattern Ingested: ${pattern.id}`);
            return { content: [{ type: "text", text: `Successfully ingested pattern: ${pattern.id}` }] };
          }
          case "proactive_suggest": {
            const { prompt } = z.object({ prompt: z.string() }).parse(request.params.arguments);
            AgenticBlackboard.postIntent(agentName, "suggest", prompt, this.rootPath);
            const ctx = await this.scoutProject(prompt);
            CommandCenterDashboard.log(`Sampling LLM for technical recommendation...`);
            const responseText = await this.requestModelText(
              "Proactive suggestion",
              `Context: ${JSON.stringify(ctx)}. Task: "${prompt}". 3-step plan?`,
              500,
            );
            return {
              content: [{
                type: "text",
                text: responseText
                  ? `**AUTONOMOUS RECOMMENDATION**\n\n${responseText}`
                  : "Autonomous recommendation unavailable because MCP sampling is not supported by the current client/runtime."
              }]
            };
          }
          case "generate_agent_onboarding": {
            const ctx = await this.scoutProject();
            CommandCenterDashboard.log(`Generating project onboarding document (AGENTS.md)...`);
            const responseText = await this.requestModelText(
              "Agent onboarding generation",
              `Context: ${JSON.stringify(ctx)}. Create AGENTS.md.`,
              1000,
            );
            return {
              content: [{
                type: "text",
                text: responseText || "AGENTS.md generation unavailable because MCP sampling is not supported by the current client/runtime."
              }]
            };
          }
          case "ingest_commits": {
            const { limit } = z.object({ limit: z.number().optional() }).parse(request.params.arguments);
            const count = await CommitIngester.ingestLatest(this.rootPath, limit || 10);
            CommandCenterDashboard.log(`Manual Ingestion: ${count} commits.`);
            return { content: [{ type: "text", text: `Successfully ingested ${count} commits.` }] };
          }
          case "derive_lessons": {
            CommandCenterDashboard.log(`Executing Learning Layer Analysis...`);
            const extractor = new LessonExtractor(this.requestModelText.bind(this));
            await extractor.extractNewLessons();
            CommandCenterDashboard.log(`Learning Layer Analysis complete.`);
            return { content: [{ type: "text", text: "Successfully completed lesson extraction cycle." }] };
          }
          case "correlate_history": {
            CommandCenterDashboard.log(`Executing Historical Correlation Engine...`);
            const engine = new CorrelationEngine();
            await engine.correlateAll();
            CommandCenterDashboard.log(`Historical Correlation complete.`);
            return { content: [{ type: "text", text: "Successfully completed correlation cycle." }] };
          }
          case "optimize_prompt": {
            const { prompt, iterations } = z.object({ prompt: z.string(), iterations: z.number().optional() }).parse(request.params.arguments);
            AgenticBlackboard.postIntent(agentName, "optimize", prompt, this.rootPath);
            const ctx = await this.scoutProject(prompt);
            const optimizer = new PromptOptimizer(this.requestModelText.bind(this));
            const optimized = await optimizer.optimize(prompt, ctx, iterations || 2);
            return { content: [{ type: "text", text: optimized }] };
          }
          case "generate_templates": {
            CommandCenterDashboard.log(`Executing Autonomous Template Synthesis...`);
            const repoId = this.repository.id;
            const generator = new TemplateGenerator(this.requestModelText.bind(this));
            await generator.generateNewTemplates(repoId);
            CommandCenterDashboard.log(`Template Synthesis complete.`);
            return { content: [{ type: "text", text: "Successfully completed template generation cycle." }] };
          }
          case "record_agent_output": {
            const { prompt_id, output_summary, artifacts_json, status } = z.object({
              prompt_id: z.string(),
              output_summary: z.string(),
              artifacts_json: z.string().optional(),
              status: z.enum(["completed", "failed"]).optional()
            }).parse(request.params.arguments);

            CommandCenterDashboard.log(`Recording agent output for prompt ${prompt_id.substring(0, 10)}...`);
            
            let execution = this.eventStore.getExecutionByPromptId(prompt_id);
            const now = new Date().toISOString();

            if (!execution) {
              const execId = `exec_${randomUUID()}`;
              this.eventStore.recordExecution({
                id: execId,
                prompt_id: prompt_id,
                workflow_name: "external-agent",
                executor_name: agentName,
                status: status || "completed",
                started_at: now,
                ended_at: now,
                result_summary: output_summary,
                artifacts_json: artifacts_json || "{}"
              });
            } else {
              this.eventStore.updateExecution({
                id: execution.id,
                status: status || "completed",
                ended_at: now,
                result_summary: output_summary,
                artifacts_json: artifacts_json || execution.artifacts_json
              });
            }

            return { content: [{ type: "text", text: `Successfully recorded output for prompt ${prompt_id}.` }] };
          }
          case "evaluate_prompt": {
            const { prompt, baseline_prompt } = z.object({
              prompt: z.string(),
              baseline_prompt: z.string().optional(),
            }).parse(request.params.arguments);
            const evaluation = baseline_prompt ? evaluatePrompt(prompt, baseline_prompt) : evaluatePrompt(prompt);
            return { content: [{ type: "text", text: JSON.stringify(evaluation) }] };
          }
          case "compare_prompt_variants": {
            const outcomeSchema = z.object({
              status: z.enum(["completed", "failed", "cancelled"]),
              testsPassed: z.number().nonnegative().optional(),
              testsFailed: z.number().nonnegative().optional(),
              reworkCount: z.number().nonnegative().optional(),
            });
            const { baseline_prompt, variant_a, variant_b, outcome_a, outcome_b } = z.object({
              baseline_prompt: z.string(),
              variant_a: z.string(),
              variant_b: z.string(),
              outcome_a: outcomeSchema.optional(),
              outcome_b: outcomeSchema.optional(),
            }).parse(request.params.arguments);
            const experiment = createABEvaluationRecord({
              experimentId: `exp_${randomUUID()}`,
              baselinePrompt: baseline_prompt,
              variantA: { id: "A", prompt: variant_a, observedOutcome: outcome_a },
              variantB: { id: "B", prompt: variant_b, observedOutcome: outcome_b },
            });
            return { content: [{ type: "text", text: JSON.stringify(experiment) }] };
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        RuntimeLogger.error(`Tool handler failed: ${request.params.name}`, error);
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${request.params.name}`);
      }
    });
  }

  async run(options: { background?: boolean } = {}) {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.running = true;

    if (options.background) {
      this.backgroundAutonomy = new BackgroundAutonomyService(
        this.rootPath,
        this.requestModelText.bind(this),
        30_000,
      );
      this.backgroundAutonomy.start();
    }

    RuntimeLogger.info(`Prompt Refiner ${getDisplayVersion()} running on stdio`, { rootPath: this.rootPath });
    console.error(`Prompt Refiner ${getDisplayVersion()} running on stdio`);
  }

  async stop() {
    if (!this.running && !this.backgroundAutonomy) {
      return;
    }
    this.backgroundAutonomy?.stop();
    await this.backgroundAutonomy?.idle();
    this.backgroundAutonomy = null;
    await this.server.close().catch(() => undefined);
    this.running = false;
  }
}
