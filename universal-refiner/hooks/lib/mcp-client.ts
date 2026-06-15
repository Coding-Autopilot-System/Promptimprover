import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolveServerPath()],
    stderr: "pipe",
  });
  const client = new Client({ name: "promptimprover-cross-cli-hook", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema,
      { timeout: timeoutMs() },
    );
    const text = result.content.find((item) => item.type === "text");
    if (!text || text.type !== "text") throw new Error(`MCP tool ${name} returned no text content.`);
    return text.text;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function resolveServerPath(): string {
  const configured = process.env.PROMPTIMPROVER_SERVER_PATH;
  if (configured) return path.resolve(configured);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../src/index.js"),
    path.resolve(here, "../../dist/src/index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function timeoutMs(): number {
  const configured = Number(process.env.PROMPTIMPROVER_HOOK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}
