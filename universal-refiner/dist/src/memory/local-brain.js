import * as fs from "fs";
import * as path from "path";
import { RuntimeLogger } from "../core/logger.js";
export class LocalBrain {
    static STORAGE_NAME = "memory.json";
    static DOT_REFINER = ".refiner";
    static getStoragePath(rootPath) {
        return path.join(rootPath, this.DOT_REFINER, this.STORAGE_NAME);
    }
    static ensureStorage(rootPath) {
        const storagePath = this.getStoragePath(rootPath);
        const dir = path.dirname(storagePath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(storagePath)) {
            fs.writeFileSync(storagePath, JSON.stringify({ patterns: [] }));
        }
    }
    static getPatterns(rootPath = ".", includeProposed = false) {
        this.ensureStorage(rootPath);
        try {
            const storagePath = this.getStoragePath(rootPath);
            const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
            const patterns = data.patterns || [];
            if (!includeProposed) {
                return patterns.filter((p) => !p.isProposed);
            }
            return patterns;
        }
        catch (error) {
            RuntimeLogger.error(`Failed to read local brain patterns for ${rootPath}`, error);
            return [];
        }
    }
    static savePattern(pattern, rootPath = ".") {
        this.ensureStorage(rootPath);
        const storagePath = this.getStoragePath(rootPath);
        try {
            const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
            const newPattern = {
                ...pattern,
                learnedAt: new Date().toISOString()
            };
            const existingIndex = data.patterns.findIndex((p) => p.id === pattern.id);
            if (existingIndex >= 0) {
                data.patterns[existingIndex] = newPattern;
            }
            else {
                data.patterns.push(newPattern);
            }
            fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
            return newPattern;
        }
        catch (error) {
            RuntimeLogger.error(`Failed to save local brain pattern ${pattern.id} for ${rootPath}`, error);
            throw error;
        }
    }
    static approvePattern(id, rootPath = ".") {
        this.ensureStorage(rootPath);
        const storagePath = this.getStoragePath(rootPath);
        try {
            const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
            const pattern = data.patterns.find((p) => p.id === id);
            if (pattern) {
                pattern.isProposed = false;
                fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
            }
        }
        catch (error) {
            RuntimeLogger.error(`Failed to approve local brain pattern ${id} for ${rootPath}`, error);
            throw error;
        }
    }
}
