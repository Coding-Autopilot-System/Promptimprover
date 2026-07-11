import * as fs from "fs";
import * as path from "path";
import { AgenticBlackboard } from "./blackboard.js";

export interface RefinerConfig {
  mandates?: string[];
  ignoredPaths?: string[];
  semantic?: Partial<SemanticConfig>;
  atlassian?: any;
  obsidian?: any;
}

export interface SemanticConfig {
  localEnabled: boolean;
  mcpSamplingEnabled: boolean;
  baseUrl: string;
  models: string[];
  apiKey: string | null;
  timeoutMs: number;
  temperature: number;
  allowNonLoopback: boolean;
  extraHeaders: Record<string, string>;
}

export class ConfigManager {
  private static CONFIG_FILE = ".universal-refiner.json";
  private static LEGACY_CONFIG_FILE = ".gemini-refiner.json";
  private static DEFAULT_SEMANTIC_CONFIG: SemanticConfig = {
    localEnabled: true,
    mcpSamplingEnabled: true,
    baseUrl: "http://localhost:9000/v1",
    models: ["gemma3:12b", "gemma3:1b"],
    apiKey: null,
    timeoutMs: 120000,
    temperature: 0.2,
    allowNonLoopback: false,
    extraHeaders: {},
  };

  private static readEnvSemanticBaseUrl(): string | null {
    const env = process.env;
    const raw = env.PROMPT_REFINER_BASE_URL
      || env.MAF_BASE_URL
      || env.GEMINI_BASE_URL
      || env.OPENAI_BASE_URL
      || env.OPENROUTER_BASE_URL
      || "";
    const value = raw.trim();
    return value.length > 0 ? value : null;
  }

  private static readEnvSemanticModels(): string[] {
    const env = process.env;
    const raw = env.PROMPT_REFINER_MODELS
      || env.MAF_MODEL_CANDIDATES
      || env.MAF_MODEL
      || env.GEMINI_MODEL
      || env.OPENAI_MODEL
      || "";
    return raw
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
  }

  private static readEnvSemanticApiKey(): string | null {
    const env = process.env;
    const raw = env.PROMPT_REFINER_API_KEY
      || env.MAF_API_KEY
      || env.GEMINI_API_KEY
      || env.OPENROUTER_API_KEY
      || env.OPENAI_API_KEY
      || "";
    const value = raw.trim();
    return value.length > 0 ? value : null;
  }

  private static readEnvSemanticAllowNonLoopback(): boolean | null {
    const raw = (process.env.PROMPT_REFINER_ALLOW_NON_LOOPBACK || "").trim().toLowerCase();
    if (!raw) {
      return null;
    }
    return raw === "1" || raw === "true" || raw === "yes";
  }

  private static readEnvSemanticHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const referer = (process.env.OPENROUTER_HTTP_REFERER || "").trim();
    const title = (process.env.OPENROUTER_X_TITLE || "").trim();
    if (referer) {
      headers["HTTP-Referer"] = referer;
    }
    if (title) {
      headers["X-Title"] = title;
    }
    return headers;
  }

  static loadConfig(rootPath: string = "."): RefinerConfig {
    const configPath = this.resolveConfigPath(rootPath);
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

  private static resolveConfigPath(rootPath: string): string {
    const configPath = path.join(rootPath, this.CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      return configPath;
    }

    const legacyPath = path.join(rootPath, this.LEGACY_CONFIG_FILE);
    if (fs.existsSync(legacyPath)) {
      console.warn(`${this.LEGACY_CONFIG_FILE} is deprecated; rename it to ${this.CONFIG_FILE}.`);
      return legacyPath;
    }

    return configPath;
  }

  static mergeConfig(rootPath: string = ".", updates: Partial<RefinerConfig>): void {
    const configPath = path.join(rootPath, this.CONFIG_FILE);
    const current = this.loadConfig(rootPath);
    const merged = { ...current, ...updates };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
  }

  static getSemanticConfig(rootPath: string = "."): SemanticConfig {
    const semantic = this.loadConfig(rootPath).semantic || {};
    const defaults = this.DEFAULT_SEMANTIC_CONFIG;
    const envBaseUrl = this.readEnvSemanticBaseUrl();
    const envModels = this.readEnvSemanticModels();
    const envApiKey = this.readEnvSemanticApiKey();
    const envAllowNonLoopback = this.readEnvSemanticAllowNonLoopback();
    const envHeaders = this.readEnvSemanticHeaders();
    return {
      localEnabled: typeof semantic.localEnabled === "boolean" ? semantic.localEnabled : defaults.localEnabled,
      mcpSamplingEnabled: typeof semantic.mcpSamplingEnabled === "boolean" ? semantic.mcpSamplingEnabled : defaults.mcpSamplingEnabled,
      baseUrl: typeof semantic.baseUrl === "string" && semantic.baseUrl.trim()
        ? semantic.baseUrl.trim()
        : (envBaseUrl || defaults.baseUrl),
      models: Array.isArray(semantic.models) && semantic.models.length > 0 && semantic.models.every(model => typeof model === "string" && model.trim())
        ? semantic.models.map(model => model.trim())
        : (envModels.length > 0 ? envModels : defaults.models),
      apiKey: typeof semantic.apiKey === "string" && semantic.apiKey.trim()
        ? semantic.apiKey.trim()
        : envApiKey,
      timeoutMs: typeof semantic.timeoutMs === "number" && Number.isFinite(semantic.timeoutMs) && semantic.timeoutMs > 0
        ? semantic.timeoutMs
        : defaults.timeoutMs,
      temperature: typeof semantic.temperature === "number" && Number.isFinite(semantic.temperature) && semantic.temperature >= 0 && semantic.temperature <= 2
        ? semantic.temperature
        : defaults.temperature,
      allowNonLoopback: typeof semantic.allowNonLoopback === "boolean"
        ? semantic.allowNonLoopback
        : (envAllowNonLoopback ?? Boolean(envBaseUrl && !envBaseUrl.startsWith("http://localhost") && !envBaseUrl.startsWith("http://127.0.0.1") && !envBaseUrl.startsWith("http://[::1]")) || defaults.allowNonLoopback),
      extraHeaders: typeof semantic.extraHeaders === "object" && semantic.extraHeaders !== null && !Array.isArray(semantic.extraHeaders)
        ? Object.fromEntries(
            Object.entries(semantic.extraHeaders).filter(
              ([key, value]) => key.trim().length > 0 && typeof value === "string" && value.trim().length > 0,
            ),
          )
        : envHeaders,
    };
  }

  static getAtlassianConfig(rootPath: string = "."): any | null {
    return this.loadConfig(rootPath).atlassian || null;
  }

  static getObsidianConfig(rootPath: string = "."): any | null {
    return this.loadConfig(rootPath).obsidian || null;
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
