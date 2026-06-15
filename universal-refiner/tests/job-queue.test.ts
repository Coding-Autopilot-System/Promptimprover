import { describe, expect, it, vi } from "vitest";
import { SerializedJobQueue } from "../src/core/job-queue.js";
import { RuntimeLogger } from "../src/core/logger.js";

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

  it("logs permanent failures and accepts the key again after completion", async () => {
    const queue = new SerializedJobQueue();
    const error = vi.spyOn(RuntimeLogger, "error").mockImplementation(() => undefined);
    const job = vi.fn().mockRejectedValue("permanent");

    expect(queue.enqueue("failure", job, { retries: 0 })).toBe(true);
    await queue.idle();
    expect(error).toHaveBeenCalledWith("Queued job failed permanently: failure", "permanent");
    expect(queue.enqueue("failure", async () => undefined)).toBe(true);
    await queue.idle();
  });

  it("uses default retry options and renders non-Error failures", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(RuntimeLogger, "warn").mockImplementation(() => undefined);
    const queue = new SerializedJobQueue();
    const job = vi.fn()
      .mockRejectedValueOnce("transient")
      .mockResolvedValue(undefined);

    queue.enqueue("defaults", job);
    await vi.runAllTimersAsync();
    await queue.idle();
    vi.useRealTimers();

    expect(warn).toHaveBeenCalledWith("Queued job retry: defaults", {
      attempt: 1,
      error: "transient",
    });
  });
});
