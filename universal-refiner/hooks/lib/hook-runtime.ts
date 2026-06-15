import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type HookInput = Record<string, unknown>;

export interface HookState {
  promptId: string;
  client: string;
  createdAt: string;
}

export interface McpToolCaller {
  (name: string, args: Record<string, unknown>): Promise<string>;
}

const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_STDIN_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const TRANSPORT_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOENT"]);

export function parseHookInput(raw: string): HookInput {
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  return normalized ? JSON.parse(normalized) as HookInput : {};
}

export function readHookInput(descriptor = 0, maxBytes = DEFAULT_MAX_STDIN_BYTES): HookInput {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_STDIN_BYTES;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, limit - totalBytes + 1));
    const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > limit) throw Object.assign(new Error("Hook input exceeds the configured limit."), { code: "INPUT_TOO_LARGE" });
    chunks.push(chunk.subarray(0, bytesRead));
  }

  return parseHookInput(Buffer.concat(chunks, totalBytes).toString("utf8"));
}

export function sanitizeError(error: unknown): string {
  const code = errorCode(error);
  if (code === "INPUT_TOO_LARGE") return "input-too-large";
  if (code === -32001 || code === "ETIMEDOUT") return "timeout";
  if (code === -32000 || (typeof code === "string" && TRANSPORT_ERROR_CODES.has(code))) return "transport-error";
  if (error instanceof SyntaxError) return "invalid-input";
  return "hook-error";
}

export function detectClient(input: HookInput): string {
  const explicit = stringField(input, "client");
  if (explicit) return explicit.toLowerCase();

  const event = stringField(input, "hook_event_name");
  if (event === "UserPromptSubmit" || event === "Stop") return "claude";
  if (event === "BeforeAgent" || event === "AfterAgent") return "gemini";
  return "generic";
}

export function extractPrompt(input: HookInput): string | undefined {
  return firstString(input, ["prompt", "user_prompt", "input"]);
}

export function extractPromptId(text: string): string | undefined {
  const tagged = text.match(/\[PROMPT_ID:\s*([^\]\s]+)\]/)?.[1];
  if (tagged) return tagged;
  try {
    const parsed = JSON.parse(text) as { promptId?: unknown };
    return typeof parsed.promptId === "string" ? parsed.promptId : undefined;
  } catch {
    return undefined;
  }
}

export function extractOutputLength(input: HookInput): number {
  return firstString(input, [
    "prompt_response",
    "last_assistant_message",
    "response",
    "output",
  ])?.length ?? 0;
}

export function buildLintContext(lintText: string, promptId?: string): string {
  let gaps: Array<{ message?: unknown; suggestedAction?: unknown }> = [];
  try {
    const parsed = JSON.parse(lintText) as { gaps?: Array<{ message?: unknown; suggestedAction?: unknown }> };
    gaps = Array.isArray(parsed.gaps) ? parsed.gaps : [];
  } catch {
    return promptId
      ? `PromptImprover tracked this turn as ${promptId}. Continue normally.`
      : "PromptImprover linting completed. Continue normally.";
  }

  const lines = gaps.slice(0, 5).map((gap) => {
    const message = typeof gap.message === "string" ? gap.message : "Prompt quality gap detected.";
    const action = typeof gap.suggestedAction === "string" ? ` ${gap.suggestedAction}` : "";
    return `- ${message}${action}`;
  });

  const tracking = promptId ? ` Tracking ID: ${promptId}.` : "";
  if (lines.length === 0) return `PromptImprover found no actionable prompt gaps.${tracking}`;
  return `PromptImprover found advisory gaps.${tracking}\n${lines.join("\n")}`;
}

export function allowOutput(input: HookInput, additionalContext?: string): Record<string, unknown> {
  const event = stringField(input, "hook_event_name");
  if (!additionalContext) return { decision: "allow" };

  return {
    decision: "allow",
    hookSpecificOutput: {
      ...(event ? { hookEventName: event } : {}),
      additionalContext,
    },
  };
}

export function statePath(input: HookInput): string {
  const key = [
    detectClient(input),
    stringField(input, "session_id") ?? stringField(input, "sessionId") ?? "no-session",
    stringField(input, "cwd") ?? process.cwd(),
    firstString(input, [
      "request_id", "requestId",
      "invocation_id", "invocationId",
      "turn_id", "turnId",
      "hook_id", "hookId",
      "transcript_path", "transcriptPath",
    ]) ?? "no-hook-id",
  ].join("|");
  const hash = createHash("sha256").update(key).digest("hex");
  return path.join(os.tmpdir(), "promptimprover-hooks", `${hash}.json`);
}

export function saveState(input: HookInput, state: HookState): void {
  const file = statePath(input);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
}

export function loadState(input: HookInput): HookState | undefined {
  const file = statePath(input);
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as HookState;
    if (!state.promptId || Date.now() - Date.parse(state.createdAt) > STATE_MAX_AGE_MS) {
      fs.rmSync(file, { force: true });
      return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

export function clearState(input: HookInput): void {
  fs.rmSync(statePath(input), { force: true });
}

export async function runPrePrompt(input: HookInput, callTool: McpToolCaller): Promise<Record<string, unknown>> {
  const prompt = extractPrompt(input);
  if (!prompt?.trim()) return allowOutput(input);

  try {
    const lintText = await callTool("lint_prompt", { prompt, semantic: false });
    const promptId = extractPromptId(lintText);
    if (promptId) {
      saveState(input, {
        promptId,
        client: detectClient(input),
        createdAt: new Date().toISOString(),
      });
    }
    return allowOutput(input, buildLintContext(lintText, promptId));
  } catch {
    return allowOutput(input);
  }
}

export async function runPostExecution(input: HookInput, callTool: McpToolCaller): Promise<Record<string, unknown>> {
  const state = loadState(input);
  const promptId = stringField(input, "prompt_id") ?? state?.promptId;
  if (!promptId) return allowOutput(input);

  const client = state?.client ?? detectClient(input);
  const outputLength = extractOutputLength(input);
  try {
    await callTool("record_agent_output", {
      prompt_id: promptId,
      output_summary: `${client} completed the tracked turn; output_length=${outputLength}.`,
      artifacts_json: JSON.stringify({
        client,
        hook_event: stringField(input, "hook_event_name") ?? "manual",
        output_length: outputLength,
      }),
      status: stringField(input, "status") === "failed" ? "failed" : "completed",
    });
    return allowOutput(input);
  } finally {
    clearState(input);
  }
}

function firstString(input: HookInput, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = stringField(input, field);
    if (value) return value;
  }
  return undefined;
}

function stringField(input: HookInput, field: string): string | undefined {
  const value = input[field];
  return typeof value === "string" ? value : undefined;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}
