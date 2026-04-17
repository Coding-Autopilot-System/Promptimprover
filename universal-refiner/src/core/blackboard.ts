import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RuntimeLogger } from "./logger.js";

export interface AgentIntent {
  agentName: string;
  toolType: string;
  intent: string;
  timestamp: string;
  expiresAt: string;
  projectPath?: string;
}

export interface SystemLog {
  timestamp: string;
  message: string;
  projectPath?: string;
}

export interface BlackboardData {
  activeIntents: AgentIntent[];
  logs: SystemLog[];
  lastRefinement?: {
    original: string;
    refined: string;
    timestamp: string;
    gain: number;
  };
}

export class AgenticBlackboard {
  private static STORAGE_NAME = "blackboard.json";
  private static DOT_REFINER = ".refiner";
  private static writeQueue: Promise<void> = Promise.resolve();
  private static listeners: Array<() => void> = [];

  private static getGlobalDir(): string {
    return process.env.PROMPT_REFINER_GLOBAL_DIR || path.join(os.homedir(), ".refiner");
  }

  private static getGlobalLogPath(): string {
    return path.join(this.getGlobalDir(), "global_history.json");
  }

  private static findProjectRoot(startPath: string): string {
    try {
      let current = path.resolve(startPath);
      while (current !== path.parse(current).root) {
        if (fs.existsSync(path.join(current, this.DOT_REFINER))) {
          return current;
        }
        current = path.dirname(current);
      }
      return path.resolve(startPath);
    } catch (error) {
      RuntimeLogger.warn(`Failed to resolve project root for ${startPath}`, error);
      return path.resolve(".");
    }
  }

  private static getStoragePath(rootPath: string): string {
    const projectRoot = this.findProjectRoot(rootPath);
    return path.join(projectRoot, this.DOT_REFINER, this.STORAGE_NAME);
  }

  private static ensureStorage(rootPath: string) {
    try {
      const storagePath = this.getStoragePath(rootPath);
      const dir = path.dirname(storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(storagePath)) {
        fs.writeFileSync(storagePath, JSON.stringify({ activeIntents: [], logs: [] }));
      }
    } catch (error) {
      RuntimeLogger.error("Failed to ensure project blackboard storage", error);
    }
  }

  private static ensureGlobalStorage() {
    try {
      const globalDir = this.getGlobalDir();
      const globalLog = this.getGlobalLogPath();
      if (!fs.existsSync(globalDir)) fs.mkdirSync(globalDir, { recursive: true });
      if (!fs.existsSync(globalLog)) {
        fs.writeFileSync(globalLog, JSON.stringify({ logs: [], projects: [] }));
      }
    } catch (error) {
      RuntimeLogger.error("Failed to ensure global blackboard storage", error);
    }
  }

  private static readJsonFile<T>(storagePath: string, fallback: T): T {
    try {
      if (!fs.existsSync(storagePath)) {
        return fallback;
      }

      return JSON.parse(fs.readFileSync(storagePath, "utf-8")) as T;
    } catch (error) {
      RuntimeLogger.error(`Failed to read JSON file: ${storagePath}`, error);
      return fallback;
    }
  }

  private static atomicUpdate<T>(storagePath: string, fallback: T, updater: (data: T) => void): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => {
      try {
        const data = this.readJsonFile<T>(storagePath, fallback);
        updater(data);
        fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
      } catch (error) {
        RuntimeLogger.error(`Atomic update failed for ${storagePath}`, error);
      }
    });

    return this.writeQueue;
  }

  private static notifyListeners() {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        RuntimeLogger.error("Listener notification failed", error);
      }
    }
  }

  private static afterQueuedWrite(callback: () => void) {
    void this.writeQueue.then(() => callback());
  }

  static async flushPendingWrites() {
    await this.writeQueue;
  }

  static postLog(message: string, rootPath: string = ".") {
    const logEntry: SystemLog = {
      timestamp: new Date().toISOString(),
      message,
      projectPath: path.resolve(rootPath)
    };

    const storagePath = this.getStoragePath(rootPath);
    this.ensureStorage(rootPath);
    void this.atomicUpdate<BlackboardData>(storagePath, { activeIntents: [], logs: [] }, (data) => {
      if (!data.logs) data.logs = [];
      data.logs.unshift(logEntry);
      if (data.logs.length > 200) data.logs.pop();
    });

    this.ensureGlobalStorage();
    void this.atomicUpdate<{ logs: SystemLog[]; projects: string[] }>(
      this.getGlobalLogPath(),
      { logs: [], projects: [] },
      (globalData) => {
        if (!globalData.logs) globalData.logs = [];
        globalData.logs.unshift(logEntry);
        if (globalData.logs.length > 500) globalData.logs.pop();

        if (!globalData.projects) globalData.projects = [];
        const absPath = path.resolve(rootPath);
        if (!globalData.projects.includes(absPath)) globalData.projects.push(absPath);
      }
    );

    this.afterQueuedWrite(() => this.notifyListeners());
  }

  static onUpdate(callback: () => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  static getGlobalData() {
    this.ensureGlobalStorage();
    return this.readJsonFile(this.getGlobalLogPath(), { logs: [], projects: [] });
  }

  static async setLastRefinement(original: string, refined: string, rootPath: string = ".", gain: number = 0) {
    const storagePath = this.getStoragePath(rootPath);
    this.ensureStorage(rootPath);

    await this.atomicUpdate<BlackboardData>(storagePath, { activeIntents: [], logs: [] }, (data) => {
      data.lastRefinement = {
        original,
        refined,
        timestamp: new Date().toISOString(),
        gain
      };
    });

    this.postLog(`Refinement Complete (Gain: ${gain}%)`, rootPath);
  }

  static getLastRefinement(rootPath: string = ".") {
    const storagePath = this.getStoragePath(rootPath);
    const data = this.readJsonFile<BlackboardData>(storagePath, { activeIntents: [], logs: [] });
    return data.lastRefinement || null;
  }

  static getLogs(rootPath: string = "."): SystemLog[] {
    const storagePath = this.getStoragePath(rootPath);
    const data = this.readJsonFile<BlackboardData>(storagePath, { activeIntents: [], logs: [] });
    return data.logs || [];
  }

  static postIntent(agentName: string, toolType: string, intent: string, rootPath: string = ".") {
    const storagePath = this.getStoragePath(rootPath);
    this.ensureStorage(rootPath);

    const newIntent: AgentIntent = {
      agentName,
      toolType,
      intent,
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      projectPath: path.resolve(rootPath)
    };

    void this.atomicUpdate<BlackboardData>(storagePath, { activeIntents: [], logs: [] }, (data) => {
      if (!data.activeIntents) data.activeIntents = [];
      data.activeIntents = data.activeIntents.filter((i: AgentIntent) =>
        i.agentName !== agentName && new Date(i.expiresAt) > new Date()
      );
      data.activeIntents.push(newIntent);
    });

    this.postLog(`Agent [${agentName}] intent: ${intent.substring(0, 50)}...`, rootPath);
    return newIntent;
  }

  static getActiveIntents(rootPath: string = "."): AgentIntent[] {
    const storagePath = this.getStoragePath(rootPath);
    const data = this.readJsonFile<BlackboardData>(storagePath, { activeIntents: [], logs: [] });
    return (data.activeIntents || []).filter((i: AgentIntent) => new Date(i.expiresAt) > new Date());
  }
}
