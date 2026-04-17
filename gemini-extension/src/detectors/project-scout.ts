import * as fs from "fs";
import * as path from "path";

import { LearnedPattern, LocalBrain } from "../memory/local-brain.js";
import { Snippet } from "../memory/neural-snippets.js";
import { AgentIntent } from "../core/blackboard.js";

export interface ProjectContext {
  language: string;
  framework: string;
  testing: string;
  packageManager?: string;
  scripts?: string[];
  isTypeScript: boolean;
  architecturalPatterns?: string[];
  learnedPatterns?: LearnedPattern[];
  relevantSnippets?: Snippet[];
  activeIntents?: AgentIntent[];
}

export class ArchitecturalScout {
  static async detectPatterns(): Promise<string[]> {
    const patterns: string[] = [];
    const dirs = fs.readdirSync(".", { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    // Clean Architecture / Domain-Driven Detection
    if (dirs.includes("domain") && dirs.includes("application") && dirs.includes("infrastructure")) {
      patterns.push("Clean Architecture / DDD");
    }

    // Modern Web Patterns
    if (dirs.includes("components") && dirs.includes("hooks") && dirs.includes("services")) {
      patterns.push("Modern Component-Based Architecture (React/Vue style)");
    }

    // MVC Pattern
    if (dirs.includes("controllers") && dirs.includes("models") && dirs.includes("views")) {
      patterns.push("MVC (Model-View-Controller)");
    }

    // Gemini CLI Extension Pattern
    if (dirs.includes("hooks") && dirs.includes("skills")) {
      patterns.push("Gemini CLI Extension Project");
    }

    // Modern TypeScript/Node Pattern
    if (dirs.includes("src") && fs.existsSync("tsconfig.json")) {
      patterns.push("Modular TypeScript/Node Project");
    }

    // Git Detection (Search for .git folder or parent .git)
    if (fs.existsSync(".git") || fs.existsSync("../.git")) {
      patterns.push("Git Repository");
    }

    return patterns;
  }
}

export class NodeDetector {
  static async detect(): Promise<Partial<ProjectContext>> {
    if (!fs.existsSync("package.json")) return {};

    try {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      const context: Partial<ProjectContext> = {
        language: fs.existsSync("tsconfig.json") ? "TypeScript" : "JavaScript",
        isTypeScript: fs.existsSync("tsconfig.json"),
        packageManager: fs.existsSync("package-lock.json") ? "npm" : (fs.existsSync("yarn.lock") ? "yarn" : "pnpm"),
        scripts: Object.keys(pkg.scripts || {}),
      };

      if (deps["express"]) context.framework = "Express";
      if (deps["@nestjs/core"]) context.framework = "NestJS";
      if (deps["react"]) context.framework = "React";
      if (deps["next"]) context.framework = "Next.js";

      if (deps["jest"]) context.testing = "Jest";
      if (deps["vitest"]) context.testing = "Vitest";
      if (deps["cypress"]) context.testing = "Cypress";

      return context;
    } catch {
      return {};
    }
  }
}

export class PythonDetector {
  static async detect(): Promise<Partial<ProjectContext>> {
    const hasReqs = fs.existsSync("requirements.txt");
    const hasPyProject = fs.existsSync("pyproject.toml");

    if (!hasReqs && !hasPyProject) return {};

    const context: Partial<ProjectContext> = { language: "Python", isTypeScript: false };
    
    let content = "";
    if (hasReqs) content = fs.readFileSync("requirements.txt", "utf-8");
    if (hasPyProject) content += fs.readFileSync("pyproject.toml", "utf-8");

    if (content.includes("fastapi")) context.framework = "FastAPI";
    if (content.includes("django")) context.framework = "Django";
    if (content.includes("flask")) context.framework = "Flask";
    if (content.includes("pytest")) context.testing = "Pytest";

    return context;
  }
}
