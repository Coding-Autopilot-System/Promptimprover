"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const express_1 = __importDefault(require("express"));
/**
 * MCP Server for Prompt Refinement
 * Using SSE Transport for shared access across Gemini, Claude, and Codex.
 */
class PromptRefinerServer {
    server;
    app = (0, express_1.default)();
    transport;
    constructor() {
        this.server = new index_js_1.Server({
            name: "prompt-refiner",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupExpress();
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "lint_prompt",
                    description: "Analyzes a prompt for missing engineering details (gaps).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            prompt: { type: "string", description: "The original user prompt." },
                        },
                        required: ["prompt"],
                    },
                },
                {
                    name: "create_questions",
                    description: "Generates clarifying questions based on identified gaps.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            gaps: {
                                type: "array",
                                items: { type: "string" },
                                description: "List of missing details identified by lint_prompt."
                            },
                        },
                        required: ["gaps"],
                    },
                },
                {
                    name: "finalize_prompt",
                    description: "Produces a refined, production-grade prompt based on answers.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            original_prompt: { type: "string" },
                            answers: {
                                type: "object",
                                description: "Key-value pairs of user answers to clarifying questions."
                            },
                        },
                        required: ["original_prompt", "answers"],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            switch (request.params.name) {
                case "lint_prompt":
                    return this.handleLintPrompt(request.params.arguments);
                case "create_questions":
                    return this.handleCreateQuestions(request.params.arguments);
                case "finalize_prompt":
                    return this.handleFinalizePrompt(request.params.arguments);
                default:
                    throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
        });
    }
    async handleLintPrompt(args) {
        const { prompt } = zod_1.z.object({ prompt: zod_1.z.string() }).parse(args);
        const gaps = [];
        if (!prompt.toLowerCase().includes("test"))
            gaps.push("Missing testing strategy");
        if (!prompt.toLowerCase().includes("framework") && !prompt.toLowerCase().includes("language")) {
            gaps.push("Unspecified technology stack (language/framework)");
        }
        if (!prompt.toLowerCase().includes("error") && !prompt.toLowerCase().includes("handle")) {
            gaps.push("Missing error handling requirements");
        }
        return {
            content: [{ type: "text", text: JSON.stringify(gaps) }],
        };
    }
    async handleCreateQuestions(args) {
        const { gaps } = zod_1.z.object({ gaps: zod_1.z.array(zod_1.z.string()) }).parse(args);
        const questions = gaps.map((gap) => ({
            header: "Refinement",
            question: `Regarding ${gap}: How should we address this?`,
            type: "text",
            placeholder: `e.g., use Jest/Pytest/etc.`
        }));
        return {
            content: [{ type: "text", text: JSON.stringify(questions) }],
        };
    }
    async handleFinalizePrompt(args) {
        const { original_prompt, answers } = zod_1.z.object({
            original_prompt: zod_1.z.string(),
            answers: zod_1.z.record(zod_1.z.string(), zod_1.z.any()),
        }).parse(args);
        let refined = `**REFINED PROMPT**\n\nOriginal Task: ${original_prompt}\n\n`;
        refined += "Engineering Context:\n";
        for (const [key, value] of Object.entries(answers)) {
            refined += `- ${key}: ${value}\n`;
        }
        refined += "\nMandates:\n";
        refined += "- Follow SOLID principles and clean code patterns.\n";
        refined += "- Include comprehensive unit tests and documentation.\n";
        refined += "- Ensure all security vulnerabilities are addressed (OWASP).\n";
        refined += "- Make frequent, small commits with clear messages.";
        return {
            content: [{ type: "text", text: refined }],
        };
    }
    setupExpress() {
        this.app.use(express_1.default.json());
        this.app.get("/sse", async (req, res) => {
            console.error("New SSE connection");
            const transport = new sse_js_1.SSEServerTransport("/messages", res);
            await this.server.connect(transport);
        });
        this.app.post("/messages", async (req, res) => {
            console.error("Received message");
            // Note: SSEServerTransport handles the response
            await this.transport?.handlePostMessage(req, res);
        });
    }
    async run(port = 7071) {
        this.app.listen(port, () => {
            console.error(`Prompt Refiner MCP server listening on port ${port}`);
            console.error(`SSE endpoint: http://localhost:${port}/sse`);
        });
    }
}
const server = new PromptRefinerServer();
server.run().catch(console.error);
