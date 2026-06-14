import { describe, expect, it, vi } from "vitest";
import { SerializedJobQueue } from "../src/core/job-queue.js";

describe("SerializedJobQueue", () => {
  it("coalesces duplicate pending jobs and serializes distinct jobs", async () => {
    const queue = new SerializedJobQueue();
    const order: string[] = [];
    expect(queue.enqueue("same", async () => {
      order.push("first-start");
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push("first-end");
    })).toBe(true);
    expect(queue.enqueue("same", async () => order.push("duplicate"))).toBe(false);
    expect(queue.enqueue("second", async () => order.push("second"))).toBe(true);
    await queue.idle();
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("retries transient failures", async () => {
    const queue = new SerializedJobQueue();
    const job = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(undefined);
    queue.enqueue("retry", job, { retries: 1, retryDelayMs: 1 });
    await queue.idle();
    expect(job).toHaveBeenCalledTimes(2);
  });
});
