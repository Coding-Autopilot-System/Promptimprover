import { describe, expect, it } from "vitest";
import { runAbruptRecovery } from "../../scripts/operations/event-store-abrupt-recovery.mjs";
import { runEventStoreSoak } from "../../scripts/stress/event-store-soak.mjs";

describe("real-process EventStore recovery and soak", () => {
  it("recovers every committed event after abrupt process termination", async () => {
    const result = await runAbruptRecovery({ writes: 12 });

    expect(result).toMatchObject({ integrity: "ok", recoveredWrites: 13 });
  }, 30_000);

  it("runs a finite mixed-operation soak within integrity thresholds", async () => {
    const result = await runEventStoreSoak({
      workers: 2,
      durationMs: 500,
      minOperations: 6,
      maxLossRatio: 0,
    });

    expect(result.integrity).toBe("ok");
    expect(result.lossRatio).toBe(0);
    expect(result.expected.operations).toBeGreaterThanOrEqual(6);
  }, 35_000);
});
