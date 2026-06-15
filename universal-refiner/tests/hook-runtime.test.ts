import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  allowOutput,
  buildLintContext,
  clearState,
  detectClient,
  extractOutputLength,
  extractPrompt,
  extractPromptId,
  loadState,
  parseHookInput,
  readHookInput,
  runPostExecution,
  runPrePrompt,
  sanitizeError,
  saveState,
  statePath,
} from "../hooks/lib/hook-runtime.js";

const input = {
  session_id: "hook-test-session",
  cwd: "C:\\repo\\example",
  hook_event_name: "BeforeAgent",
  prompt: "Implement the feature",
};

afterEach(() => clearState(input));

describe("cross-CLI hook runtime", () => {
  it("normalizes prompt fields and extracts tracking IDs", () => {
    expect(parseHookInput('\uFEFF{"prompt":"hello"}')).toEqual({ prompt: "hello" });
    expect(parseHookInput(" \n ")).toEqual({});
    expect(() => parseHookInput("{")).toThrow();
    expect(extractPrompt({ user_prompt: "hello" })).toBe("hello");
    expect(extractPrompt({ input: "fallback" })).toBe("fallback");
    expect(extractPrompt({ prompt: 1 })).toBeUndefined();
    expect(extractPromptId("[PROMPT_ID: ref_123]\nTask")).toBe("ref_123");
    expect(extractPromptId('{"promptId":"prm_123","gaps":[]}')).toBe("prm_123");
    expect(extractPromptId('{"promptId":123}')).toBeUndefined();
    expect(extractPromptId("not json")).toBeUndefined();
  });

  it("bounds total hook input size and sanitizes failures", () => {
    const file = path.join(path.dirname(statePath(input)), "bounded-input.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"prompt":"ok"}');
    const descriptor = fs.openSync(file, "r");
    expect(readHookInput(descriptor, 32)).toEqual({ prompt: "ok" });
    fs.closeSync(descriptor);

    const invalidLimitDescriptor = fs.openSync(file, "r");
    expect(readHookInput(invalidLimitDescriptor, 0)).toEqual({ prompt: "ok" });
    fs.closeSync(invalidLimitDescriptor);

    fs.writeFileSync(file, "x".repeat(33));
    const oversizedDescriptor = fs.openSync(file, "r");
    let oversizedError: unknown;
    try {
      readHookInput(oversizedDescriptor, 32);
    } catch (error) {
      oversizedError = error;
    } finally {
      fs.closeSync(oversizedDescriptor);
      fs.rmSync(file, { force: true });
    }
    expect(sanitizeError(oversizedError)).toBe("input-too-large");

    expect(sanitizeError(Object.assign(new Error("secret path"), { code: -32001 }))).toBe("timeout");
    expect(sanitizeError(Object.assign(new Error("secret timeout"), { code: "ETIMEDOUT" }))).toBe("timeout");
    expect(sanitizeError(Object.assign(new Error("secret transport"), { code: -32000 }))).toBe("transport-error");
    expect(sanitizeError(Object.assign(new Error("secret transport"), { code: "ECONNRESET" }))).toBe("transport-error");
    expect(sanitizeError(new SyntaxError("secret input"))).toBe("invalid-input");
    expect(sanitizeError(new Error("secret generic"))).toBe("hook-error");
    expect(sanitizeError("secret unknown")).toBe("hook-error");
  });

  it("detects explicit and event-derived clients", () => {
    expect(detectClient({ client: "CoDeX" })).toBe("codex");
    expect(detectClient({ hook_event_name: "UserPromptSubmit" })).toBe("claude");
    expect(detectClient({ hook_event_name: "Stop" })).toBe("claude");
    expect(detectClient({ hook_event_name: "BeforeAgent" })).toBe("gemini");
    expect(detectClient({ hook_event_name: "AfterAgent" })).toBe("gemini");
    expect(detectClient({})).toBe("generic");
  });

  it("extracts output lengths from every supported field", () => {
    expect(extractOutputLength({ prompt_response: "one" })).toBe(3);
    expect(extractOutputLength({ last_assistant_message: "four" })).toBe(4);
    expect(extractOutputLength({ response: "12345" })).toBe(5);
    expect(extractOutputLength({ output: "123456" })).toBe(6);
    expect(extractOutputLength({ output: 7 })).toBe(0);
  });

  it("formats advisory lint context without exposing the original prompt", () => {
    const context = buildLintContext(JSON.stringify({
      gaps: [{ message: "Testing is unspecified.", suggestedAction: "Add acceptance criteria." }],
    }), "ref_123");

    expect(context).toContain("Testing is unspecified.");
    expect(context).toContain("ref_123");
    expect(context).not.toContain(input.prompt);
    expect(buildLintContext('{"gaps":"invalid"}')).toBe("PromptImprover found no actionable prompt gaps.");
    expect(buildLintContext('{"gaps":[]}', "tracked")).toContain("tracked");
    expect(buildLintContext('{"gaps":[{}]}')).toContain("Prompt quality gap detected.");
    expect(buildLintContext("invalid", "tracked")).toContain("tracked");
    expect(buildLintContext("invalid")).toBe("PromptImprover linting completed. Continue normally.");
    expect(buildLintContext(JSON.stringify({ gaps: Array.from({ length: 6 }, (_, index) => ({ message: `${index}` })) })))
      .not.toContain("- 5");
  });

  it("creates client-compatible fail-open output", () => {
    expect(allowOutput(input, "advice")).toEqual({
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "BeforeAgent",
        additionalContext: "advice",
      },
    });
    expect(allowOutput(input)).toEqual({ decision: "allow" });
    expect(allowOutput({}, "advice")).toEqual({
      decision: "allow",
      hookSpecificOutput: { additionalContext: "advice" },
    });
  });

  it("uses stable state paths and removes invalid or stale state", () => {
    expect(statePath(input)).toBe(statePath(input));
    expect(statePath({ sessionId: "camel", cwd: "C:/repo" })).not.toBe(statePath(input));
    expect(statePath({ ...input, request_id: "one" })).not.toBe(statePath({ ...input, request_id: "two" }));
    expect(statePath({ ...input, hookId: "one" })).not.toBe(statePath({ ...input, hookId: "two" }));
    expect(statePath({})).toMatch(/promptimprover-hooks[\\/].+\.json$/);

    saveState(input, { promptId: "", client: "gemini", createdAt: new Date().toISOString() });
    expect(loadState(input)).toBeUndefined();
    expect(fs.existsSync(statePath(input))).toBe(false);

    saveState(input, { promptId: "old", client: "gemini", createdAt: "2000-01-01T00:00:00.000Z" });
    expect(loadState(input)).toBeUndefined();

    fs.mkdirSync(path.dirname(statePath(input)), { recursive: true });
    fs.writeFileSync(statePath(input), "{", "utf8");
    expect(loadState(input)).toBeUndefined();
  });

  it("lints, creates a trackable prompt, and persists only correlation metadata", async () => {
    const call = vi.fn().mockResolvedValueOnce('{"promptId":"prm_456","gaps":[]}');

    await expect(runPrePrompt(input, call)).resolves.toMatchObject({ decision: "allow" });
    expect(call).toHaveBeenCalledWith("lint_prompt", { prompt: input.prompt, semantic: false });
    expect(loadState(input)).toMatchObject({ promptId: "prm_456", client: "gemini" });
    expect(fs.readFileSync).toBeDefined();
  });

  it("fails open when linting times out", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("timeout"));

    await expect(runPrePrompt(input, call)).resolves.toEqual({ decision: "allow" });
    expect(loadState(input)).toBeUndefined();
  });

  it("fails open for empty prompts and does not persist untracked lint results", async () => {
    const call = vi.fn().mockResolvedValue('{"gaps":[]}');
    await expect(runPrePrompt({ ...input, prompt: " " }, call)).resolves.toEqual({ decision: "allow" });
    await expect(runPrePrompt({ ...input, prompt: "usable" }, call)).resolves.toMatchObject({ decision: "allow" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(loadState(input)).toBeUndefined();
  });

  it("records a privacy-safe completion and clears correlation state", async () => {
    const preCall = vi.fn().mockResolvedValueOnce('{"promptId":"prm_789","gaps":[]}');
    await runPrePrompt(input, preCall);

    const postCall = vi.fn().mockResolvedValue("ok");
    await runPostExecution({
      ...input,
      hook_event_name: "AfterAgent",
      prompt_response: "private response body",
    }, postCall);

    expect(postCall).toHaveBeenCalledWith("record_agent_output", expect.objectContaining({
      prompt_id: "prm_789",
      output_summary: "gemini completed the tracked turn; output_length=21.",
    }));
    expect(JSON.stringify(postCall.mock.calls)).not.toContain("private response body");
    expect(loadState(input)).toBeUndefined();
  });

  it("records explicit failed completions without prior state and permits untracked completions", async () => {
    const call = vi.fn().mockResolvedValue("ok");
    await expect(runPostExecution({}, call)).resolves.toEqual({ decision: "allow" });
    await runPostExecution({
      client: "CODEX",
      prompt_id: "explicit",
      status: "failed",
      output: "result",
    }, call);

    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith("record_agent_output", expect.objectContaining({
      prompt_id: "explicit",
      status: "failed",
      output_summary: "codex completed the tracked turn; output_length=6.",
      artifacts_json: JSON.stringify({ client: "codex", hook_event: "manual", output_length: 6 }),
    }));
  });

  it("clears correlation state even when post recording fails", async () => {
    saveState(input, { promptId: "stale-if-retained", client: "gemini", createdAt: new Date().toISOString() });
    const call = vi.fn().mockRejectedValue(new Error("recording failed"));

    await expect(runPostExecution(input, call)).rejects.toThrow("recording failed");
    expect(loadState(input)).toBeUndefined();
  });
});
