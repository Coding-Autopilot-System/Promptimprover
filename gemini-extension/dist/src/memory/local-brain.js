import * as fs from "fs";
import * as path from "path";
export class LocalBrain {
    static STORAGE_FILE = ".gemini/memory.json";
    static ensureStorage() {
        const dir = path.dirname(this.STORAGE_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.STORAGE_FILE)) {
            fs.writeFileSync(this.STORAGE_FILE, JSON.stringify({ patterns: [] }));
        }
    }
    static getPatterns() {
        this.ensureStorage();
        try {
            const data = JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
            return data.patterns || [];
        }
        catch {
            return [];
        }
    }
    static savePattern(pattern) {
        this.ensureStorage();
        const data = JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
        const newPattern = {
            ...pattern,
            learnedAt: new Date().toISOString()
        };
        // De-duplicate by ID
        const existingIndex = data.patterns.findIndex((p) => p.id === pattern.id);
        if (existingIndex >= 0) {
            data.patterns[existingIndex] = newPattern;
        }
        else {
            data.patterns.push(newPattern);
        }
        fs.writeFileSync(this.STORAGE_FILE, JSON.stringify(data, null, 2));
        return newPattern;
    }
}
