#!/usr/bin/env node
import { callMcpTool } from "./lib/mcp-client.js";
import { allowOutput, HookInput, readHookInput, runPostExecution, sanitizeError } from "./lib/hook-runtime.js";

async function main(): Promise<void> {
  let input: HookInput = {};
  try {
    input = readHookInput();
    console.log(JSON.stringify(await runPostExecution(input, callMcpTool)));
  } catch (error) {
    console.error(`[PromptImprover] Post-execution hook failed open: ${sanitizeError(error)}`);
    console.log(JSON.stringify(allowOutput(input)));
  }
}

void main();
