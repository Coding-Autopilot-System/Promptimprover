import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NodeDetector, PythonDetector, ArchitecturalScout } from "../detectors/project-scout.js";
import { PromptLinter } from "../linters/prompt-linter.js";
import { PromptRefiner } from "../refiners/prompt-refiner.js";
import { LocalBrain } from "../memory/local-brain.js";
import { NeuralSnippets } from "../memory/neural-snippets.js";
import { AgenticBlackboard } from "./blackboard.js";
export class PromptRefinerServer {
    server;
    constructor() {
        this.server = new Server({ name: "prompt-refiner", version: "6.0.0" }, { capabilities: { tools: {}, logging: {}, experimental: { sampling: {} } } });
        this.setupToolHandlers();
    }
    async scoutProject(query) {
        const nodeCtx = await NodeDetector.detect();
        const pyCtx = await PythonDetector.detect();
        const patterns = await ArchitecturalScout.detectPatterns();
        const learned = LocalBrain.getPatterns();
        const snippets = query ? await NeuralSnippets.search(query) : [];
        const activeIntents = AgenticBlackboard.getActiveIntents();
        return {
            language: nodeCtx.language || pyCtx.language || "Unknown",
            framework: nodeCtx.framework || pyCtx.framework || "Unknown",
            testing: nodeCtx.testing || pyCtx.testing || "Unknown",
            isTypeScript: nodeCtx.isTypeScript || false,
            packageManager: nodeCtx.packageManager,
            scripts: nodeCtx.scripts,
            architecturalPatterns: patterns,
            learnedPatterns: learned,
            relevantSnippets: snippets,
            activeIntents,
        };
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "lint_prompt",
                    description: "Performs modular analysis of a prompt and codebase.",
                    inputSchema: {
                        type: "object",
                        properties: { prompt: { type: "string" } },
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
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            switch (request.params.name) {
                case "lint_prompt": {
                    const { prompt } = z.object({ prompt: z.string() }).parse(request.params.arguments);
                    // Post intent to blackboard for cross-agent coordination
                    const agentName = request.params._meta?.progressToken || "Unknown Agent";
                    AgenticBlackboard.postIntent(String(agentName), "mcp-tool", prompt);
                    const ctx = await this.scoutProject(prompt);
                    const gaps = PromptLinter.lint(prompt, ctx);
                    return { content: [{ type: "text", text: JSON.stringify({ gaps, context: ctx }) }] };
                }
                case "create_questions": {
                    const { gaps } = z.object({ gaps: z.array(z.any()) }).parse(request.params.arguments);
                    const questions = gaps.map((gap) => ({
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
                    const ctx = await this.scoutProject(original_prompt);
                    const refined = PromptRefiner.refine(original_prompt, ctx, answers);
                    return { content: [{ type: "text", text: refined }] };
                }
                case "proactive_suggest": {
                    const { prompt } = z.object({ prompt: z.string() }).parse(request.params.arguments);
                    const ctx = await this.scoutProject(prompt);
                    // Use Sampling (M2M) to ask the host model for a recommendation
                    const result = await this.server.createMessage({
                        messages: [
                            {
                                role: "user",
                                content: {
                                    type: "text",
                                    text: `Based on this project context: ${JSON.stringify(ctx)}, what is the recommended engineering plan for the task: "${prompt}"? Provide a concise, 3-step technical suggestion.`
                                }
                            }
                        ],
                        maxTokens: 1000,
                        modelPreferences: {
                            speedPriority: 0.5,
                            intelligencePriority: 1.0,
                        }
                    });
                    return {
                        content: [{
                                type: "text",
                                text: `**AUTONOMOUS RECOMMENDATION**\n\n${result.content.type === "text" ? result.content.text : "Could not generate suggestion."}`
                            }]
                    };
                }
                case "generate_agent_onboarding": {
                    const ctx = await this.scoutProject();
                    const result = await this.server.createMessage({
                        messages: [
                            {
                                role: "user",
                                content: {
                                    type: "text",
                                    text: `Create an AGENTS.md file for a project with this context: ${JSON.stringify(ctx)}. 
                  The file should include:
                  1. Project Overview (Detect language and framework).
                  2. Architectural Mandates (Explain how to follow detected patterns like ${ctx.architecturalPatterns?.join(", ") || "standard modularity"}).
                  3. Development Standards (SOLID, SRP, Git).
                  4. Testing Guide (Using ${ctx.testing}).
                  5. Security Rules (OWASP).
                  Format as a high-quality Markdown file for AI agents to read.`
                                }
                            }
                        ],
                        maxTokens: 2000,
                    });
                    return {
                        content: [{
                                type: "text",
                                text: result.content.type === "text" ? result.content.text : "Failed to generate AGENTS.md content."
                            }]
                    };
                }
                case "ingest_pattern": {
                    const args = z.object({
                        id: z.string(),
                        category: z.string(),
                        description: z.string(),
                    }).parse(request.params.arguments);
                    const pattern = LocalBrain.savePattern(args);
                    return {
                        content: [{
                                type: "text",
                                text: `Successfully ingested pattern: ${pattern.id} into local brain.`
                            }]
                    };
                }
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Prompt Refiner v6.0 (Command Center) running on stdio");
    }
}
