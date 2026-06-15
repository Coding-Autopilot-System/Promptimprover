import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitPoller } from "../src/history/git-poller.js";
import { CommitIngester } from "../src/history/commit-ingest.js";

// ---------------------------------------------------------------------------
// Stub CommitIngester so tests don't touch the real DB / git log
// ---------------------------------------------------------------------------

vi.mock("../src/history/commit-ingest.js", () => ({
  CommitIngester: {
    ingestLatest: vi.fn(),
  },
}));

vi.mock("../src/core/logger.js", () => ({
  RuntimeLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../src/core/dashboard.js", () => ({
  CommandCenterDashboard: { log: vi.fn() },
}));

const ingestLatest = vi.mocked(CommitIngester.ingestLatest);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GitPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ingestLatest.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // AUTO-03: poll() calls CommitIngester.ingestLatest
  // -------------------------------------------------------------------------

  it("poll() calls CommitIngester.ingestLatest with the repo path (AUTO-03)", async () => {
    const poller = new GitPoller("/repo");
    await poller.poll();
    expect(ingestLatest).toHaveBeenCalledWith("/repo", 50);
  });

  // -------------------------------------------------------------------------
  // AUTO-04: emits "commits" when new commits found
  // -------------------------------------------------------------------------

  it("emits 'commits' event when ingestLatest returns > 0 (AUTO-04)", async () => {
    ingestLatest.mockResolvedValue(3);
    const poller = new GitPoller("/repo");
    const handler = vi.fn();
    poller.on("commits", handler);

    await poller.poll();

    expect(handler).toHaveBeenCalledWith(3);
  });

  it("does NOT emit 'commits' when ingestLatest returns 0", async () => {
    ingestLatest.mockResolvedValue(0);
    const poller = new GitPoller("/repo");
    const handler = vi.fn();
    poller.on("commits", handler);

    await poller.poll();

    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // poll() return value
  // -------------------------------------------------------------------------

  it("poll() returns the count from ingestLatest", async () => {
    ingestLatest.mockResolvedValue(7);
    const poller = new GitPoller("/repo");
    const count = await poller.poll();
    expect(count).toBe(7);
  });

  it("poll() returns 0 and does not throw when ingestLatest rejects", async () => {
    ingestLatest.mockRejectedValue(new Error("git failure"));
    const poller = new GitPoller("/repo");
    const count = await poller.poll();
    expect(count).toBe(0);
  });

  it("coalesces overlapping polls", async () => {
    let release!: (count: number) => void;
    ingestLatest.mockReturnValue(new Promise<number>(resolve => {
      release = resolve;
    }));
    const poller = new GitPoller("/repo");

    const first = poller.poll();
    const second = poller.poll();
    expect(ingestLatest).toHaveBeenCalledOnce();
    release(2);

    await expect(Promise.all([first, second])).resolves.toEqual([2, 2]);
  });

  // -------------------------------------------------------------------------
  // AUTO-03: start() triggers polling on interval
  // -------------------------------------------------------------------------

  it("start() triggers poll at the configured interval", async () => {
    const poller = new GitPoller("/repo", 1000);
    poller.start();

    await vi.advanceTimersByTimeAsync(2100);
    poller.stop();

    expect(ingestLatest.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("start() is idempotent; calling twice does not double the interval", async () => {
    const poller = new GitPoller("/repo", 1000);
    poller.start();
    poller.start();

    await vi.advanceTimersByTimeAsync(1000);
    poller.stop();

    // One interval fired exactly once
    expect(ingestLatest.mock.calls.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // stop() clears the interval
  // -------------------------------------------------------------------------

  it("stop() prevents further interval polls", async () => {
    const poller = new GitPoller("/repo", 1000);
    poller.start();

    await vi.advanceTimersByTimeAsync(1000);
    const callsBeforeStop = ingestLatest.mock.calls.length;
    poller.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(ingestLatest.mock.calls.length).toBe(callsBeforeStop);
  });

  it("stop() is idempotent before start and handles a missing timer", () => {
    const poller = new GitPoller("/repo");
    expect(() => poller.stop()).not.toThrow();

    (poller as any).running = true;
    (poller as any).timer = null;
    expect(() => poller.stop()).not.toThrow();
  });
});
