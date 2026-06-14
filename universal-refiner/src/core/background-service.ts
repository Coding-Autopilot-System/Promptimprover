import * as chokidar from 'chokidar';
import { CommitIngester } from "../history/commit-ingest.js";
import { LessonExtractor } from "../history/lesson-extractor.js";
import { CorrelationEngine } from "../history/correlation-engine.js";
import { RuntimeLogger } from "./logger.js";
import { CommandCenterDashboard } from "./dashboard.js";
import { SerializedJobQueue } from "./job-queue.js";

export class BackgroundAutonomyService {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private rootPath: string;
  private requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>;
  private queue = new SerializedJobQueue();

  constructor(
    rootPath: string,
    requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  ) {
    this.rootPath = rootPath;
    this.requestModelText = requestModelText;
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
      // Don't log every single file change to dashboard to avoid noise, but log to RuntimeLogger
      RuntimeLogger.debug(`File change detected: ${event} ${filePath}`);
      this.triggerAutonomy();
    });

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
      
      // a) CommitIngester.ingestLatest()
      // We increase the limit significantly because the ingester now fetches only since last SHA
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
  }

  public async idle() {
    await this.queue.idle();
  }
}
