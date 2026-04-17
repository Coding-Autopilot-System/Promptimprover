import * as fs from "fs";
import * as path from "path";
export class AgenticBlackboard {
    static STORAGE_FILE = ".gemini/blackboard.json";
    static ensureStorage() {
        const dir = path.dirname(this.STORAGE_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.STORAGE_FILE)) {
            fs.writeFileSync(this.STORAGE_FILE, JSON.stringify({ activeIntents: [] }));
        }
    }
    static postIntent(agentName, toolType, intent) {
        this.ensureStorage();
        const data = JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
        const newIntent = {
            agentName,
            toolType,
            intent,
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString() // 30 min expiry
        };
        // Remove old intents from same agent
        data.activeIntents = data.activeIntents.filter((i) => i.agentName !== agentName && new Date(i.expiresAt) > new Date());
        data.activeIntents.push(newIntent);
        fs.writeFileSync(this.STORAGE_FILE, JSON.stringify(data, null, 2));
        return newIntent;
    }
    static getActiveIntents() {
        this.ensureStorage();
        try {
            const data = JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
            return data.activeIntents.filter((i) => new Date(i.expiresAt) > new Date());
        }
        catch {
            return [];
        }
    }
}
