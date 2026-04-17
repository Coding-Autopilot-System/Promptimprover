import * as fs from "fs";
import * as path from "path";
import { AgenticBlackboard } from "./blackboard.js";

export interface RefinerConfig {
  mandates?: string[];
  ignoredPaths?: string[];
}

export class ConfigManager {
  private static CONFIG_FILE = ".gemini-refiner.json";

  static loadConfig(rootPath: string = "."): RefinerConfig {
    const configPath = path.join(rootPath, this.CONFIG_FILE);
    if (!fs.existsSync(configPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      console.error(`Error loading config from ${configPath}:`, e);
      return {};
    }
  }

  static getPredictiveMandates(): string[] {
    const logs = AgenticBlackboard.getLogs();
    const recent = logs.slice(0, 10).map(l => l.message.toLowerCase());
    const keywords = ["test", "security", "doc", "performance", "error", "refactor"];
    const predictive: string[] = [];

    for (const kw of keywords) {
      const count = recent.filter(msg => msg.includes(kw)).length;
      if (count >= 3) {
        if (kw === "test") predictive.push("Predictive: You've asked for tests in 30% of recent prompts. Ensure comprehensive testing.");
        if (kw === "security") predictive.push("Predictive: Security is a recurring theme. Apply OWASP principles strictly.");
        if (kw === "doc") predictive.push("Predictive: Frequent documentation requests detected. Ensure JSDoc/README updates.");
      }
    }
    return predictive;
  }
}
