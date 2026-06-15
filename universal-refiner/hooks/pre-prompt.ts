#!/usr/bin/env node
import { callMcpTool } from "./lib/mcp-client.js";
import { allowOutput, HookInput, readHookInput, runPrePrompt, sanitizeError } from "./lib/hook-runtime.js";

async function main(): Promise<void> {
  let input: HookInput = {};
  try {
    input = readHookInput();
    console.log(JSON.stringify(await runPrePrompt(input, callMcpTool)));
  } catch (error) {
    console.error(`[PromptImprover] Pre-prompt hook failed open: ${sanitizeError(error)}`);
    console.log(JSON.stringify(allowOutput(input)));
  }
}

void main();
