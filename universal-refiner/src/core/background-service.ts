import * as chokidar from 'chokidar';
import { CommitIngester } from "../history/commit-ingest.js";
import { LessonExtractor } from "../history/lesson-extractor.js";
import { CorrelationEngine } from "../history/correlation-engine.js";
import { GitPoller } from "../history/git-poller.js";
import { RuntimeLogger } from "./logger.js";
import { CommandCenterDashboard } from "./dashboard.js";
import { SerializedJobQueue } from "./job-queue.js";

export class BackgroundAutonomyService {
  private watcher: chokidar.FSWatcher | null = null;
  private gitPoller: GitPoller | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private rootPath: string;
  private requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>;
  private queue = new SerializedJobQueue();

  /**
   * @param gitPollIntervalMs — pass a number (ms) to enable git polling (AUTO-03).
   *   Defaults to null (disabled) so tests that use vi.runAllTimersAsync() are not
   *   affected by an infinite setInterval.  The production server passes 30_000.
   */
  constructor(
    rootPath: string,
    requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>,
    gitPollIntervalMs: number | null = null,
  ) {
    this.rootPath = rootPath;
    this.requestModelText = requestModelText;
    if (gitPollIntervalMs !== null) {
      this.gitPoller = new GitPoller(rootPath, gitPollIntervalMs);
      this.gitPoller.on("commits", () => this.triggerAutonomy());
    }
  }

  public start() {
    if (this.watcher) {
      return;
    }

    RuntimeLogger.info("Starting Background Autonomy Service...", { rootPath: this.rootPath });
    CommandCenterDashboard.log("Background Autonomy: Watching for changes...");

    this.watcher = chokidar.watch(this.rootPath, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('all', (event, filePath) => {
      RuntimeLogger.debug(`File change detected: ${event} ${filePath}`);
      this.triggerAutonomy();
    });

    this.gitPoller?.start();
    this.queue.enqueue(`autonomy:${this.rootPath}`, () => this.runCycles());
  }

  private triggerAutonomy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const accepted = this.queue.enqueue(`autonomy:${this.rootPath}`, () => this.runCycles());
      if (!accepted) {
        RuntimeLogger.debug("Background autonomy cycle coalesced", { rootPath: this.rootPath });
      }
    }, 3000);
  }

  private async runCycles() {
    try {
      CommandCenterDashboard.log("Background Autonomy: Change detected. Triggering intelligence cycles...");
      const ingestedCount = await CommitIngester.ingestLatest(this.rootPath, 100);
      CommandCenterDashboard.log(`Background Autonomy: Ingested ${ingestedCount} commits.`);

      const engine = new CorrelationEngine();
      const extractor = new LessonExtractor(this.requestModelText);
      await engine.correlateAll();
      await extractor.extractNewLessons();
      CommandCenterDashboard.log("Background Autonomy: Correlation and lesson extraction complete.");

    } catch (error) {
      RuntimeLogger.error("Background Autonomy cycle failed", error);
      CommandCenterDashboard.log("Background Autonomy: Cycle failed. See logs.");
      throw error;
    }
  }

  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.gitPoller?.stop();
  }

  public async idle() {
    await this.queue.idle();
  }
}
