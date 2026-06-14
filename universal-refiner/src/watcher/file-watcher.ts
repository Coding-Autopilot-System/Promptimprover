import { EventEmitter } from "node:events";
import { watch as chokidarWatch, FSWatcher } from "chokidar";
import { RuntimeLogger } from "../core/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileEventKind = "add" | "change" | "unlink";

export interface FileChangeEvent {
  path: string;
  event: FileEventKind;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions considered "meaningful" for AUTO-01 */
export const MEANINGFUL_EXTENSIONS = new Set([".ts", ".js", ".md", ".txt", ".prompt"]);

/**
 * Path segments that mark noise directories (AUTO-02).
 * Used as a secondary in-process guard after chokidar's ignore patterns.
 */
export const NOISE_PATH_SEGMENTS = ["node_modules", "dist", ".git", "coverage"];

/** File suffixes that mark noise files (AUTO-02). */
export const NOISE_SUFFIXES = [".log", ".tmp"];

/** Paths and patterns passed to chokidar `ignored` option (AUTO-02). */
const CHOKIDAR_IGNORE: (string | RegExp)[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/*.log",
  "**/*.tmp",
  "**/coverage/**",
];

// ---------------------------------------------------------------------------
// FileWatcher
// ---------------------------------------------------------------------------

/**
 * FileWatcher wraps chokidar with a focused, typed EventEmitter interface.
 *
 * Responsibilities:
 *  - Detect meaningful source/prompt file changes (AUTO-01)
 *  - Filter transient/noise paths before emitting (AUTO-02)
 *
 * Usage:
 *   const watcher = new FileWatcher('/path/to/project');
 *   watcher.on('change', (evt) => console.log(evt));
 *   watcher.start();
 *   // later
 *   await watcher.stop();
 */
export class FileWatcher extends EventEmitter {
  private readonly rootPath: string;
  private inner: FSWatcher | null = null;

  constructor(rootPath: string) {
    super();
    this.rootPath = rootPath;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Start watching. Idempotent — calling twice is a no-op. */
  public start(): void {
    if (this.inner) {
      return;
    }

    RuntimeLogger.info("[FileWatcher] Starting file system watcher", {
      rootPath: this.rootPath,
    });

    this.inner = chokidarWatch(this.rootPath, {
      ignored: CHOKIDAR_IGNORE,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.inner.on("add", (filePath) => this.emitChange("add", filePath));
    this.inner.on("change", (filePath) => this.emitChange("change", filePath));
    this.inner.on("unlink", (filePath) => this.emitChange("unlink", filePath));
    this.inner.on("error", (err: unknown) => {
      RuntimeLogger.error("[FileWatcher] Watcher error", err);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }

  /** Stop watching and release all resources. */
  public async stop(): Promise<void> {
    if (!this.inner) {
      return;
    }
    await this.inner.close();
    this.inner = null;
    RuntimeLogger.info("[FileWatcher] Stopped file system watcher");
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Apply both AUTO-01 and AUTO-02 filters before emitting.
   *
   * Two-layer defence:
   *  1. chokidar `ignored` patterns (coarse, path-glob based)
   *  2. In-process extension + segment checks (precise, cross-platform)
   *
   * The in-process layer catches edge cases where chokidar's glob ignore
   * may lag (e.g. directories created before the watcher starts on Windows).
   */
  private emitChange(kind: FileEventKind, filePath: string): void {
    // Normalise separators for consistent matching on Windows
    const normalised = filePath.replace(/\\/g, "/");

    // AUTO-02: segment-level noise filter
    for (const seg of NOISE_PATH_SEGMENTS) {
      if (normalised.includes(`/${seg}/`) || normalised.includes(`/${seg}`)) {
        return;
      }
    }

    // AUTO-01: extension filter — only emit for meaningful file types
    const dotIdx = normalised.lastIndexOf(".");
    const ext = dotIdx >= 0 ? normalised.slice(dotIdx).toLowerCase() : "";

    // AUTO-02: suffix-level noise filter (e.g. .log, .tmp)
    if (NOISE_SUFFIXES.includes(ext)) {
      return;
    }

    if (!MEANINGFUL_EXTENSIONS.has(ext)) {
      return;
    }

    const evt: FileChangeEvent = {
      path: filePath,
      event: kind,
      timestamp: new Date(),
    };
    RuntimeLogger.debug(`[FileWatcher] ${kind}: ${filePath}`);
    this.emit("change", evt);
  }
}
