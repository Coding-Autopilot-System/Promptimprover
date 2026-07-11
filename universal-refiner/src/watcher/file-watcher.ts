import { EventEmitter } from "events";
import * as chokidar from "chokidar";
import * as path from "path";
import { RuntimeLogger } from "../core/logger.js";

export type FileEventKind = "add" | "change" | "unlink";

export interface FileChangeEvent {
  path: string;
  event: FileEventKind;
  timestamp: Date;
}

export const NOISE_PATH_SEGMENTS = [
  /(^|[\/\\])\../, // ignore hidden files
  "node_modules",
  "dist",
  ".git",
  "coverage"
];

export const MEANINGFUL_EXTENSIONS = new Set([".ts", ".js", ".md", ".txt", ".prompt"]);
export const NOISE_SUFFIXES = [".log", ".tmp"];

export class FileWatcher extends EventEmitter {
  private inner: chokidar.FSWatcher | null = null;
  private rootPath: string;

  constructor(rootPath: string) {
    super();
    this.rootPath = rootPath;
  }

  public async start(): Promise<void> {
    if (this.inner) {
      return;
    }

    RuntimeLogger.info(`[FileWatcher] Starting file system watcher on ${this.rootPath}`);
    this.inner = chokidar.watch(this.rootPath, {
      ignored: NOISE_PATH_SEGMENTS,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    this.inner
      .on("add", (filePath) => this.emitChange("add", filePath))
      .on("change", (filePath) => this.emitChange("change", filePath))
      .on("unlink", (filePath) => this.emitChange("unlink", filePath))
      .on("error", (error) => {
        RuntimeLogger.error(`[FileWatcher] Error: ${error}`);
        this.emit("error", typeof error === "string" ? new Error(error) : error);
      });
  }

  public async stop(): Promise<void> {
    if (this.inner) {
      RuntimeLogger.info(`[FileWatcher] Stopping file system watcher`);
      await this.inner.close();
      this.inner = null;
    }
  }

  private emitChange(event: FileEventKind, filePath: string) {
    if (!this.shouldEmit(filePath)) {
      return;
    }

    const payload: FileChangeEvent = {
      path: filePath,
      event,
      timestamp: new Date()
    };

    RuntimeLogger.debug(`[FileWatcher] Emitting ${event} for ${filePath}`);
    this.emit("change", payload);
  }

  private shouldEmit(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    
    // 1. Path segment check
    if (normalizedPath.includes("/node_modules/") || 
        normalizedPath.includes("/dist/") || 
        normalizedPath.includes("/.git/") || 
        normalizedPath.includes("/coverage/")) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    
    // 2. Extension check
    if (!MEANINGFUL_EXTENSIONS.has(ext)) {
      return false;
    }

    // 3. Suffix noise check
    for (const suffix of NOISE_SUFFIXES) {
      if (filePath.endsWith(suffix)) {
        return false;
      }
    }

    return true;
  }
}
