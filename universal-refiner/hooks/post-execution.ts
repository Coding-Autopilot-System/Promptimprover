#!/usr/bin/env node
import * as fs from "fs";
import { callMcpTool } from "./lib/mcp-client.js";
import { allowOutput, HookInput, parseHookInput, runPostExecution } from "./lib/hook-runtime.js";

async function main(): Promise<void> {
  let input: HookInput = {};
  try {
    input = parseHookInput(fs.readFileSync(0, "utf8"));
    console.log(JSON.stringify(await runPostExecution(input, callMcpTool)));
  } catch (error) {
    console.error(`[PromptImprover] Post-execution hook failed open: ${error instanceof Error ? error.message : "unknown error"}`);
    console.log(JSON.stringify(allowOutput(input)));
  }
}

void main();
