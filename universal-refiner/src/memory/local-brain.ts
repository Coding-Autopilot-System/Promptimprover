import * as fs from "fs";
import * as path from "path";
import { RuntimeLogger } from "../core/logger.js";

export interface LearnedPattern {
  id: string;
  category: string;
  description: string;
  learnedAt: string;
  isProposed?: boolean;
}

export class LocalBrain {
  private static STORAGE_NAME = "memory.json";
  private static DOT_REFINER = ".refiner";

  private static getStoragePath(rootPath: string): string {
    return path.join(rootPath, this.DOT_REFINER, this.STORAGE_NAME);
  }

  private static ensureStorage(rootPath: string) {
    const storagePath = this.getStoragePath(rootPath);
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(storagePath)) {
      fs.writeFileSync(storagePath, JSON.stringify({ patterns: [] }));
    }
  }

  static getPatterns(rootPath: string = ".", includeProposed = false): LearnedPattern[] {
    this.ensureStorage(rootPath);
    try {
      const storagePath = this.getStoragePath(rootPath);
      const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
      const patterns = data.patterns || [];
      if (!includeProposed) {
        return patterns.filter((p: LearnedPattern) => !p.isProposed);
      }
      return patterns;
    } catch (error) {
      RuntimeLogger.error(`Failed to read local brain patterns for ${rootPath}`, error);
      return [];
    }
  }

  static savePattern(pattern: Omit<LearnedPattern, "learnedAt">, rootPath: string = ".") {
    this.ensureStorage(rootPath);
    const storagePath = this.getStoragePath(rootPath);

    try {
      const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
      const patterns: LearnedPattern[] = Array.isArray(data.patterns) ? data.patterns : [];
      const newPattern: LearnedPattern = {
        ...pattern,
        learnedAt: new Date().toISOString()
      };
      
      const existingIndex = patterns.findIndex((p: LearnedPattern) => p.id === pattern.id);
      if (existingIndex >= 0) {
        patterns[existingIndex] = newPattern;
      } else {
        patterns.push(newPattern);
      }
      data.patterns = patterns;

      fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
      return newPattern;
    } catch (error) {
      RuntimeLogger.error(`Failed to save local brain pattern ${pattern.id} for ${rootPath}`, error);
      throw error;
    }
  }

  static approvePattern(id: string, rootPath: string = ".") {
    this.ensureStorage(rootPath);
    const storagePath = this.getStoragePath(rootPath);

    try {
      const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
      const patterns: LearnedPattern[] = Array.isArray(data.patterns) ? data.patterns : [];
      const pattern = patterns.find((p: LearnedPattern) => p.id === id);
      if (pattern) {
        pattern.isProposed = false;
        fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
      }
    } catch (error) {
      RuntimeLogger.error(`Failed to approve local brain pattern ${id} for ${rootPath}`, error);
      throw error;
    }
  }
}
