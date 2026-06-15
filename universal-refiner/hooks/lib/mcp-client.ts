import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const DEFAULT_TIMEOUT_MS = 15_000;
const RECONNECT_SAFE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOENT"]);

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const deadline = Date.now() + timeoutMs();
  try {
    return await callMcpToolOnce(name, args, deadline);
  } catch (error) {
    if (!isReconnectSafeTransportFailure(error)) throw error;
    return callMcpToolOnce(name, args, deadline);
  }
}

async function callMcpToolOnce(name: string, args: Record<string, unknown>, deadline: number): Promise<string> {
  remainingMs(deadline);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolveServerPath()],
    stderr: "pipe",
  });
  const client = new Client({ name: "promptimprover-cross-cli-hook", version: "1.0.0" }, { capabilities: {} });

  try {
    await withinDeadline(client.connect(transport), deadline);
    const remaining = remainingMs(deadline);
    const result = await withinDeadline(client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema,
      { timeout: remaining, maxTotalTimeout: remaining },
    ), deadline);
    const text = result.content.find((item) => item.type === "text");
    if (!text) throw new Error(`MCP tool ${name} returned no text content.`);
    return text.text;
  } finally {
    await withinDeadline(client.close(), deadline).catch(() => undefined);
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

function remainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError();
  return remaining;
}

async function withinDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = remainingMs(deadline);
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError()), remaining);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function isReconnectSafeTransportFailure(error: unknown): boolean {
  const code = errorCode(error);
  return code === ErrorCode.ConnectionClosed || (typeof code === "string" && RECONNECT_SAFE_CODES.has(code));
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function timeoutError(): Error & { code: ErrorCode.RequestTimeout } {
  return Object.assign(new Error("MCP hook deadline exceeded."), { code: ErrorCode.RequestTimeout as const });
}
