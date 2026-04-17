import * as fs from "fs";
import * as path from "path";

export interface LearnedPattern {
  id: string;
  category: string;
  description: string;
  learnedAt: string;
}

export class LocalBrain {
  private static STORAGE_FILE = ".gemini/memory.json";

  private static ensureStorage() {
    const dir = path.dirname(this.STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.STORAGE_FILE)) {
      fs.writeFileSync(this.STORAGE_FILE, JSON.stringify({ patterns: [] }));
    }
  }

  static getPatterns(): LearnedPattern[] {
    this.ensureStorage();
    try {
      const data = JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
      return data.patterns || [];
    } catch {
      return [];
    }
  }

  static savePattern(pattern: Omit<LearnedPattern, "learnedAt">) {
    this.ensureStorage();
    const data = JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
    const newPattern: LearnedPattern = {
      ...pattern,
      learnedAt: new Date().toISOString()
    };
    
    // De-duplicate by ID
    const existingIndex = data.patterns.findIndex((p: any) => p.id === pattern.id);
    if (existingIndex >= 0) {
      data.patterns[existingIndex] = newPattern;
    } else {
      data.patterns.push(newPattern);
    }

    fs.writeFileSync(this.STORAGE_FILE, JSON.stringify(data, null, 2));
    return newPattern;
  }
}
