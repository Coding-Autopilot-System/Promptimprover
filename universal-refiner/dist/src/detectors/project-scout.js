import * as fs from "fs";
import * as path from "path";
import { RuntimeLogger } from "../core/logger.js";
export class ArchitecturalScout {
    static async detectPatterns(rootPath = ".") {
        const patterns = [];
        if (!fs.existsSync(rootPath))
            return patterns;
        try {
            const entries = fs.readdirSync(rootPath, { withFileTypes: true });
            const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
            const files = entries.filter(e => !e.isDirectory()).map(e => e.name);
            if (dirs.includes("domain") && dirs.includes("application") && dirs.includes("infrastructure")) {
                patterns.push("Clean Architecture / DDD");
            }
            if (dirs.includes("components") && dirs.includes("hooks") && dirs.includes("services")) {
                patterns.push("Modern Component-Based Architecture (React/Vue style)");
            }
            if (dirs.includes("controllers") && dirs.includes("models") && dirs.includes("views")) {
                patterns.push("MVC (Model-View-Controller)");
            }
            if (dirs.includes("hooks") && dirs.includes("skills")) {
                patterns.push("Gemini CLI Extension Project");
            }
            if ((dirs.includes("src") || dirs.includes("lib")) && (files.includes("tsconfig.json") || files.includes("package.json"))) {
                patterns.push("Modular TypeScript/Node Project");
            }
            if (dirs.length > 2 && (dirs.includes("packages") || dirs.includes("apps") || dirs.includes("services") || dirs.includes("universal-refiner"))) {
                patterns.push(`Monorepo (${dirs.filter(d => !d.startsWith(".")).join(", ")})`);
            }
            if (dirs.includes(".git") || fs.existsSync(path.join(rootPath, "../.git"))) {
                patterns.push("Git Repository");
            }
            if (patterns.length <= 1) {
                for (const dir of dirs.slice(0, 5)) {
                    if (dir.startsWith("."))
                        continue;
                    const childPath = path.join(rootPath, dir);
                    const subEntries = fs.readdirSync(childPath, { withFileTypes: true });
                    const subDirs = subEntries.filter(e => e.isDirectory()).map(e => e.name);
                    const subFiles = subEntries.filter(e => !e.isDirectory()).map(e => e.name);
                    if (subDirs.includes("src") || subFiles.includes("package.json")) {
                        patterns.push(`Multi-Module (${dir})`);
                    }
                }
            }
            return patterns;
        }
        catch (error) {
            RuntimeLogger.warn(`ArchitecturalScout.detectPatterns failed for ${rootPath}`, error);
            return patterns;
        }
    }
}
export class NodeDetector {
    static async detect(rootPath = ".") {
        let packageJsonPath = path.join(rootPath, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            const dirs = fs.readdirSync(rootPath, { withFileTypes: true })
                .filter(e => e.isDirectory() && !e.name.startsWith("."))
                .map(e => e.name);
            for (const dir of dirs) {
                const subPkgPath = path.join(rootPath, dir, "package.json");
                if (fs.existsSync(subPkgPath)) {
                    packageJsonPath = subPkgPath;
                    rootPath = path.join(rootPath, dir);
                    break;
                }
            }
        }
        if (!fs.existsSync(packageJsonPath))
            return {};
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const tsconfigPath = path.join(rootPath, "tsconfig.json");
            const packageLockPath = path.join(rootPath, "package-lock.json");
            const yarnLockPath = path.join(rootPath, "yarn.lock");
            const context = {
                language: fs.existsSync(tsconfigPath) ? "TypeScript" : "JavaScript",
                isTypeScript: fs.existsSync(tsconfigPath),
                packageManager: fs.existsSync(packageLockPath) ? "npm" : (fs.existsSync(yarnLockPath) ? "yarn" : "pnpm"),
                scripts: Object.keys(pkg.scripts || {}),
            };
            if (deps["express"] || deps["hono"])
                context.framework = deps["express"] ? "Express" : "Hono";
            if (deps["@nestjs/core"])
                context.framework = "NestJS";
            if (deps["react"])
                context.framework = "React";
            if (deps["next"])
                context.framework = "Next.js";
            if (deps["prisma"])
                context.orm = "Prisma";
            if (deps["drizzle-orm"])
                context.orm = "Drizzle";
            if (deps["typeorm"])
                context.orm = "TypeORM";
            if (deps["sequelize"])
                context.orm = "Sequelize";
            if (deps["tailwindcss"])
                context.styling = "Tailwind CSS";
            if (deps["styled-components"])
                context.styling = "Styled Components";
            if (deps["@azure/functions"])
                context.cloud = "Azure Functions";
            if (deps["@aws-sdk/client-lambda"])
                context.cloud = "AWS Lambda";
            if (deps["jest"])
                context.testing = "Jest";
            if (deps["vitest"])
                context.testing = "Vitest";
            if (deps["cypress"])
                context.testing = "Cypress";
            return context;
        }
        catch (error) {
            RuntimeLogger.warn(`NodeDetector.detect failed for ${rootPath}`, error);
            return {};
        }
    }
}
export class PythonDetector {
    static async detect(rootPath = ".") {
        const hasReqs = fs.existsSync(path.join(rootPath, "requirements.txt"));
        const hasPyProject = fs.existsSync(path.join(rootPath, "pyproject.toml"));
        if (!hasReqs && !hasPyProject)
            return {};
        const context = { language: "Python", isTypeScript: false };
        let content = "";
        try {
            if (hasReqs)
                content = fs.readFileSync(path.join(rootPath, "requirements.txt"), "utf-8");
            if (hasPyProject)
                content += fs.readFileSync(path.join(rootPath, "pyproject.toml"), "utf-8");
        }
        catch (error) {
            RuntimeLogger.warn(`PythonDetector.detect failed for ${rootPath}`, error);
            return context;
        }
        const c = content.toLowerCase();
        if (c.includes("fastapi"))
            context.framework = "FastAPI";
        if (c.includes("django"))
            context.framework = "Django";
        if (c.includes("flask"))
            context.framework = "Flask";
        if (c.includes("sqlalchemy"))
            context.orm = "SQLAlchemy";
        if (c.includes("tortoise-orm"))
            context.orm = "Tortoise ORM";
        if (c.includes("peewee"))
            context.orm = "Peewee";
        if (c.includes("pytest"))
            context.testing = "Pytest";
        if (c.includes("unittest"))
            context.testing = "Unittest";
        return context;
    }
}
