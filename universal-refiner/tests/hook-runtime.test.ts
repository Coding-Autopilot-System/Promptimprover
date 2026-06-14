import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import {
  allowOutput,
  buildLintContext,
  clearState,
  extractPrompt,
  extractPromptId,
  loadState,
  parseHookInput,
  runPostExecution,
  runPrePrompt,
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
    expect(extractPrompt({ user_prompt: "hello" })).toBe("hello");
    expect(extractPromptId("[PROMPT_ID: ref_123]\nTask")).toBe("ref_123");
    expect(extractPromptId('{"promptId":"prm_123","gaps":[]}')).toBe("prm_123");
  });

  it("formats advisory lint context without exposing the original prompt", () => {
    const context = buildLintContext(JSON.stringify({
      gaps: [{ message: "Testing is unspecified.", suggestedAction: "Add acceptance criteria." }],
    }), "ref_123");

    expect(context).toContain("Testing is unspecified.");
    expect(context).toContain("ref_123");
    expect(context).not.toContain(input.prompt);
  });

  it("creates client-compatible fail-open output", () => {
    expect(allowOutput(input, "advice")).toEqual({
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "BeforeAgent",
        additionalContext: "advice",
      },
    });
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
});
