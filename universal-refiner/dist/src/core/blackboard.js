import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RuntimeLogger } from "./logger.js";
export class AgenticBlackboard {
    static STORAGE_NAME = "blackboard.json";
    static DOT_REFINER = ".refiner";
    static writeQueue = Promise.resolve();
    static listeners = [];
    static getGlobalDir() {
        return process.env.PROMPT_REFINER_GLOBAL_DIR || path.join(os.homedir(), ".refiner");
    }
    static getGlobalLogPath() {
        return path.join(this.getGlobalDir(), "global_history.json");
    }
    static findProjectRoot(startPath) {
        try {
            let current = path.resolve(startPath);
            while (current !== path.parse(current).root) {
                if (fs.existsSync(path.join(current, this.DOT_REFINER))) {
                    return current;
                }
                current = path.dirname(current);
            }
            return path.resolve(startPath);
        }
        catch (error) {
            RuntimeLogger.warn(`Failed to resolve project root for ${startPath}`, error);
            return path.resolve(".");
        }
    }
    static getStoragePath(rootPath) {
        const projectRoot = this.findProjectRoot(rootPath);
        return path.join(projectRoot, this.DOT_REFINER, this.STORAGE_NAME);
    }
    static ensureStorage(rootPath) {
        try {
            const storagePath = this.getStoragePath(rootPath);
            const dir = path.dirname(storagePath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(storagePath)) {
                fs.writeFileSync(storagePath, JSON.stringify({ activeIntents: [], logs: [] }));
            }
        }
        catch (error) {
            RuntimeLogger.error("Failed to ensure project blackboard storage", error);
        }
    }
    static ensureGlobalStorage() {
        try {
            const globalDir = this.getGlobalDir();
            const globalLog = this.getGlobalLogPath();
            if (!fs.existsSync(globalDir))
                fs.mkdirSync(globalDir, { recursive: true });
            if (!fs.existsSync(globalLog)) {
                fs.writeFileSync(globalLog, JSON.stringify({ logs: [], projects: [] }));
            }
        }
        catch (error) {
            RuntimeLogger.error("Failed to ensure global blackboard storage", error);
        }
    }
    static readJsonFile(storagePath, fallback) {
        try {
            if (!fs.existsSync(storagePath)) {
                return fallback;
            }
            return JSON.parse(fs.readFileSync(storagePath, "utf-8"));
        }
        catch (error) {
            RuntimeLogger.error(`Failed to read JSON file: ${storagePath}`, error);
            return fallback;
        }
    }
    static atomicUpdate(storagePath, fallback, updater) {
        this.writeQueue = this.writeQueue.then(() => {
            try {
                const data = this.readJsonFile(storagePath, fallback);
                updater(data);
                fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
            }
            catch (error) {
                RuntimeLogger.error(`Atomic update failed for ${storagePath}`, error);
            }
        });
        return this.writeQueue;
    }
    static notifyListeners() {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            }
            catch (error) {
                RuntimeLogger.error("Listener notification failed", error);
            }
        }
    }
    static afterQueuedWrite(callback) {
        void this.writeQueue.then(() => callback());
    }
    static async flushPendingWrites() {
        await this.writeQueue;
    }
    static postLog(message, rootPath = ".") {
        const logEntry = {
            timestamp: new Date().toISOString(),
            message,
            projectPath: path.resolve(rootPath)
        };
        const storagePath = this.getStoragePath(rootPath);
        this.ensureStorage(rootPath);
        void this.atomicUpdate(storagePath, { activeIntents: [], logs: [] }, (data) => {
            if (!data.logs)
                data.logs = [];
            data.logs.unshift(logEntry);
            if (data.logs.length > 200)
                data.logs.pop();
        });
        this.ensureGlobalStorage();
        void this.atomicUpdate(this.getGlobalLogPath(), { logs: [], projects: [] }, (globalData) => {
            if (!globalData.logs)
                globalData.logs = [];
            globalData.logs.unshift(logEntry);
            if (globalData.logs.length > 500)
                globalData.logs.pop();
            if (!globalData.projects)
                globalData.projects = [];
            const absPath = path.resolve(rootPath);
            if (!globalData.projects.includes(absPath))
                globalData.projects.push(absPath);
        });
        this.afterQueuedWrite(() => this.notifyListeners());
    }
    static onUpdate(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(listener => listener !== callback);
        };
    }
    static getGlobalData() {
        this.ensureGlobalStorage();
        return this.readJsonFile(this.getGlobalLogPath(), { logs: [], projects: [] });
    }
    static async setLastRefinement(original, refined, rootPath = ".", gain = 0) {
        const storagePath = this.getStoragePath(rootPath);
        this.ensureStorage(rootPath);
        await this.atomicUpdate(storagePath, { activeIntents: [], logs: [] }, (data) => {
            data.lastRefinement = {
                original,
                refined,
                timestamp: new Date().toISOString(),
                gain
            };
        });
        this.postLog(`Refinement Complete (Gain: ${gain}%)`, rootPath);
    }
    static getLastRefinement(rootPath = ".") {
        const storagePath = this.getStoragePath(rootPath);
        const data = this.readJsonFile(storagePath, { activeIntents: [], logs: [] });
        return data.lastRefinement || null;
    }
    static getLogs(rootPath = ".") {
        const storagePath = this.getStoragePath(rootPath);
        const data = this.readJsonFile(storagePath, { activeIntents: [], logs: [] });
        return data.logs || [];
    }
    static postIntent(agentName, toolType, intent, rootPath = ".") {
        const storagePath = this.getStoragePath(rootPath);
        this.ensureStorage(rootPath);
        const newIntent = {
            agentName,
            toolType,
            intent,
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
            projectPath: path.resolve(rootPath)
        };
        void this.atomicUpdate(storagePath, { activeIntents: [], logs: [] }, (data) => {
            if (!data.activeIntents)
                data.activeIntents = [];
            data.activeIntents = data.activeIntents.filter((i) => i.agentName !== agentName && new Date(i.expiresAt) > new Date());
            data.activeIntents.push(newIntent);
        });
        this.postLog(`Agent [${agentName}] intent: ${intent.substring(0, 50)}...`, rootPath);
        return newIntent;
    }
    static getActiveIntents(rootPath = ".") {
        const storagePath = this.getStoragePath(rootPath);
        const data = this.readJsonFile(storagePath, { activeIntents: [], logs: [] });
        return (data.activeIntents || []).filter((i) => new Date(i.expiresAt) > new Date());
    }
}
