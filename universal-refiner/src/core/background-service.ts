import * as chokidar from 'chokidar';
import { CommitIngester } from "../history/commit-ingest.js";
import { LessonExtractor } from "../history/lesson-extractor.js";
import { CorrelationEngine } from "../history/correlation-engine.js";
import { GitPoller } from "../history/git-poller.js";
import { AutoPilotStatus } from "./autopilot-status.js";
import { RuntimeLogger } from "./logger.js";
import { CommandCenterDashboard } from "./dashboard.js";
import { SerializedJobQueue } from "./job-queue.js";
import { ExecutionOrchestrator } from "./execution-orchestrator.js";
import { EventStore } from "../history/event-store.js";
import { ConfigManager } from "./config.js";
import { TokenMinifier } from "../refiners/minifier.js";

export class BackgroundAutonomyService {
  private watcher: chokidar.FSWatcher | null = null;
  private gitPoller: GitPoller | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private rootPath: string;
  private requestModelText: (taskName: string, userPrompt: string, maxTokens: number) => Promise<string | null>;
  private queue = new SerializedJobQueue();

  /**
   * @param gitPollIntervalMs Pass a number in milliseconds to enable git polling.
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
      this.gitPoller.on("commits", (count: number) => {
        AutoPilotStatus.record(`Git poll detected ${count} new commit(s)`, "git_commit");
        this.triggerAutonomy();
      });
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
      AutoPilotStatus.record(`File ${event}: ${filePath}`, "file_change");
      this.triggerAutonomy();
    });
    this.watcher.on("error", (error) => {
      AutoPilotStatus.setIdle();
      AutoPilotStatus.record("Watcher degraded", "error");
      RuntimeLogger.error("Background autonomy watcher failed", error);
      CommandCenterDashboard.log("Background Autonomy: Watcher degraded. See logs.");
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
    AutoPilotStatus.setBusy();
    AutoPilotStatus.record("Cycle started", "cycle_start");
    CommandCenterDashboard.log("Background Autonomy: Change detected. Triggering intelligence cycles...");
    try {
      const ingestedCount = await CommitIngester.ingestLatest(this.rootPath, 100);
      if (ingestedCount > 0) {
        AutoPilotStatus.addCommits(ingestedCount);
        AutoPilotStatus.record(`Ingested ${ingestedCount} commit(s)`, "git_commit");
      }
      CommandCenterDashboard.log(`Background Autonomy: Ingested ${ingestedCount} commits.`);

      const engine = new CorrelationEngine();
      const extractor = new LessonExtractor(this.requestModelText);
      const minifier = new TokenMinifier(this.requestModelText);
      const lessonsBefore = AutoPilotStatus.getSnapshot().stats.lessonsExtracted;
      const orchestrator = new ExecutionOrchestrator(EventStore.getInstance(), this.requestModelText);
      
      const results = await Promise.allSettled([
        engine.correlateAll(),
        extractor.extractNewLessons(),
        extractor.extractFailureLessons(),
        minifier.minifyVerbosePrompts()
      ]);

      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejected) {
        throw rejected.reason;
      }

      await this.attemptSelfHealing(orchestrator);

      const lessonsAfter = AutoPilotStatus.getSnapshot().stats.lessonsExtracted;
      if (lessonsAfter > lessonsBefore) {
        AutoPilotStatus.record(`Extracted ${lessonsAfter - lessonsBefore} lesson(s)`, "lesson");
      }

      AutoPilotStatus.incrementCycles();
      AutoPilotStatus.setActive();
      AutoPilotStatus.record("Cycle complete", "cycle_complete");
      CommandCenterDashboard.log("Background Autonomy: Correlation, lesson extraction, and self-healing complete.");

      await this.syncObsidian();

    } catch (error) {
      AutoPilotStatus.setIdle();
      AutoPilotStatus.record(`Cycle failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      RuntimeLogger.error("Background Autonomy cycle failed", error);
      CommandCenterDashboard.log("Background Autonomy: Cycle failed. See logs.");
      throw error;
    }
  }

  private async attemptSelfHealing(orchestrator: ExecutionOrchestrator) {
    try {
      const lessons = EventStore.getInstance().getApprovedLessonsWithExecutions(10);

      for (const lesson of lessons) {
        // Heal and retry
        await orchestrator.healAndRetry(lesson.execution_id, lesson.id);
      }
    } catch (error) {
      RuntimeLogger.error("Self-healing failed", error);
    }
  }

  private async syncObsidian() {
    const obsidianConfig = ConfigManager.getObsidianConfig(this.rootPath);
    if (!obsidianConfig?.syncLessons) {
      return;
    }

    try {
      const { ObsidianOrchestrator } = await import("../integrations/obsidian/obsidian-orchestrator.js");
      await ObsidianOrchestrator.syncToWiki(this.rootPath);
      CommandCenterDashboard.log("Background Autonomy: Synced to Obsidian Vault.");
      AutoPilotStatus.record("Synced to Obsidian Vault", "cycle_complete");
    } catch (syncError) {
      RuntimeLogger.error("Failed to sync to Obsidian", syncError);
      CommandCenterDashboard.log("Background Autonomy: Failed to sync to Obsidian Vault.");
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
