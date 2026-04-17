import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function run() {
    const input = JSON.parse(fs.readFileSync(0, "utf-8"));
    const prompt = input.prompt;
    const answers = input.answers;
    // Connect to the local MCP Server via STDIO using absolute path
    const serverPath = "C:/repo/Promptimprover/universal-refiner/dist/src/index.js";
    const transport = new StdioClientTransport({
        command: "node",
        args: [serverPath],
    });
    const client = new Client({ name: "refine-hook", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    if (!answers) {
        // PASS 1: Lint the prompt
        const lintResult = await client.request({ method: "tools/call", params: { name: "lint_prompt", arguments: { prompt } } }, CallToolResultSchema);
        const firstContent = lintResult.content[0];
        if (firstContent.type !== "text")
            throw new Error("Expected text content");
        const { gaps } = JSON.parse(firstContent.text);
        if (gaps && gaps.length > 0) {
            // Create questions
            const questionResult = await client.request({ method: "tools/call", params: { name: "create_questions", arguments: { gaps } } }, CallToolResultSchema);
            const firstQContent = questionResult.content[0];
            if (firstQContent.type !== "text")
                throw new Error("Expected text content");
            const questions = JSON.parse(firstQContent.text);
            console.log(JSON.stringify({
                decision: "ask_user",
                questions: questions
            }));
            process.exit(0);
        }
    }
    else {
        // PASS 2: We have answers, finalize the prompt
        const finalResult = await client.request({
            method: "tools/call",
            params: {
                name: "finalize_prompt",
                arguments: { original_prompt: prompt, answers }
            }
        }, CallToolResultSchema);
        const firstFinalContent = finalResult.content[0];
        if (firstFinalContent.type !== "text")
            throw new Error("Expected text content");
        const refinedPrompt = firstFinalContent.text;
        console.log(JSON.stringify({
            prompt: refinedPrompt
        }));
        process.exit(0);
    }
    // No refinement needed or error
    console.log(JSON.stringify({ decision: "allow" }));
    process.exit(0);
}
run().catch((err) => {
    console.error(err);
    console.log(JSON.stringify({ decision: "allow" })); // Fail-open
    process.exit(0);
});
