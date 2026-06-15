import { EventEmitter } from "node:events";
import { CommitIngester } from "./commit-ingest.js";
import { RuntimeLogger } from "../core/logger.js";
import { CommandCenterDashboard } from "../core/dashboard.js";

export const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * GitPoller satisfies AUTO-03: continuously monitors a git repository for new
 * commits on a configurable interval, independent of file system events.
 *
 * Emits "commits" with the count of newly ingested commits whenever the poll
 * detects work. Consumers (BackgroundAutonomyService) subscribe to "commits"
 * to trigger the full learning pipeline (AUTO-04).
 */
export class GitPoller extends EventEmitter {
  private readonly repoPath: string;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight: Promise<number> | null = null;

  constructor(repoPath: string, intervalMs = DEFAULT_POLL_INTERVAL_MS) {
    super();
    this.repoPath = repoPath;
    this.intervalMs = intervalMs;
  }

  /** Start polling. Idempotent; calling twice is a no-op. */
  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    RuntimeLogger.info("[GitPoller] Starting git commit polling", {
      repoPath: this.repoPath,
      intervalMs: this.intervalMs,
    });
    CommandCenterDashboard.log(`Background Autonomy: Git polling every ${this.intervalMs / 1000}s.`);
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  /** Stop polling and release the interval. */
  public stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    RuntimeLogger.info("[GitPoller] Stopped git commit polling");
  }

  /**
   * One-shot poll: ingest any new commits. If new commits are found, emits
   * "commits" with the count so subscribers can trigger downstream pipelines.
   * Safe to call externally for an immediate check.
   */
  public async poll(): Promise<number> {
    if (this.inFlight) {
      RuntimeLogger.debug("[GitPoller] Skipping overlapping poll", { repoPath: this.repoPath });
      return this.inFlight;
    }

    this.inFlight = (async () => {
      try {
        const count = await CommitIngester.ingestLatest(this.repoPath, 50);
        if (count > 0) {
          RuntimeLogger.debug(`[GitPoller] Ingested ${count} new commit(s)`, { repoPath: this.repoPath });
          CommandCenterDashboard.log(`Background Autonomy: ${count} new commit(s) detected.`);
          this.emit("commits", count);
        }
        return count;
      } catch (err) {
        RuntimeLogger.error("[GitPoller] Poll failed", err);
        return 0;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
