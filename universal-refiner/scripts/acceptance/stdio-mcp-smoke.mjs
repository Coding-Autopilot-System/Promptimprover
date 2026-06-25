import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = process.cwd();
const timeoutMs = Number.parseInt(process.env.PROMPT_REFINER_STDIO_SMOKE_TIMEOUT_MS || "30000", 10);
const entry = process.env.PROMPT_REFINER_STDIO_ENTRY || join(repoRoot, "dist", "src", "index.js");
const tempRoot = await mkdtemp(join(tmpdir(), "prompt-refiner-stdio-smoke-"));
const stateDir = join(tempRoot, "state");
const homeDir = join(tempRoot, "home");

let client;
let transport;
let stderr = "";

try {
  await access(entry);
  await mkdir(stateDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: repoRoot,
    env: {
      ...process.env,
      AZURE_CONFIG_DIR: join(homeDir, ".azure"),
      HOME: homeDir,
      PORT: "0",
      PROMPT_REFINER_BACKGROUND: "false",
      PROMPT_REFINER_GLOBAL_DIR: stateDir,
      USERPROFILE: homeDir,
    },
    stderr: "pipe",
  });
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", chunk => {
    stderr += chunk;
  });

  client = new Client({ name: "prompt-refiner-stdio-smoke", version: "1.0.0" });
  await withTimeout(client.connect(transport), "initialize MCP stdio server");

  const listed = await withTimeout(client.listTools(), "list MCP tools");
  const toolNames = listed.tools.map(tool => tool.name);
  assert.ok(toolNames.includes("lint_prompt"), `lint_prompt not advertised. Tools: ${toolNames.join(", ")}`);

  const result = await withTimeout(client.callTool({
    name: "lint_prompt",
    arguments: {
      prompt: "Implement a focused change and run the relevant tests.",
      semantic: false,
    },
  }), "call lint_prompt over stdio");

  assert.equal(result.isError, undefined);
  assert.equal(result.content?.[0]?.type, "text");
  const payload = JSON.parse(result.content[0].text);
  assert.match(payload.promptId, /^prm_[0-9a-f-]{36}$/u);
  assert.ok(Array.isArray(payload.gaps), "lint_prompt gaps must be an array");
  assert.equal(typeof payload.context, "object");

  console.log(`Stdio MCP smoke passed: ${toolNames.length} tools advertised and lint_prompt returned ${payload.gaps.length} gap(s).`);
} catch (error) {
  const details = stderr.trim() ? `\nserver stderr:\n${stderr.trim()}` : "";
  throw new Error(`${error instanceof Error ? error.message : String(error)}${details}`);
} finally {
  await client?.close().catch(() => undefined);
  await transport?.close().catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true });
}

async function withTimeout(promise, action) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${action} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
