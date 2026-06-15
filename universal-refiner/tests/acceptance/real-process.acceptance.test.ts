import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "../../scripts/operations/child-process.mjs";
import { runTrackedTurnAcceptance } from "../../scripts/acceptance/tracked-turn-acceptance.mjs";

describe("real-process acceptance", () => {
  it("links a synthetic turn produced by actual hook executables and stdio MCP processes", async () => {
    const result = await runTrackedTurnAcceptance({ timeoutMs: 45_000 });

    expect(result.promptId).toMatch(/^prm_/u);
    expect(result.linkage).toMatchObject({
      prompt_id: result.promptId,
      status: "completed",
    });
  }, 60_000);

  it("fails required-live Gemma mode when no live endpoint is configured", async () => {
    const script = resolve("scripts/acceptance/semantic-provider-acceptance.mjs");
    const env = { ...process.env };
    delete env.PROMPT_REFINER_ACCEPTANCE_BASE_URL;
    delete env.PROMPT_REFINER_ACCEPTANCE_REQUIRE_LIVE;

    await expect(runProcess(process.execPath, [script, "--require-live"], {
      env,
      timeoutMs: 10_000,
    })).rejects.toThrow(/Required-live Gemma acceptance needs PROMPT_REFINER_ACCEPTANCE_BASE_URL/u);
  });
});
