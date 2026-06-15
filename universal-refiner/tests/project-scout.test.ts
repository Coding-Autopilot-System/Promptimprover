import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../src/detectors/project-scout.js";

describe("project scouts", () => {
  const directories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "project-scout-"));
    directories.push(directory);
    return directory;
  }

  it("detects architecture markers and nested modules", async () => {
    const directory = createDirectory();
    for (const name of ["domain", "application", "infrastructure", "components", "hooks", "services", "skills", "packages"]) {
      mkdirSync(join(directory, name));
    }
    writeFileSync(join(directory, "package.json"), "{}");

    const patterns = await ArchitecturalScout.detectPatterns(directory);

    expect(patterns).toContain("Clean Architecture / DDD");
    expect(patterns).toContain("Modern Component-Based Architecture (React/Vue style)");
    expect(patterns).toContain("Gemini CLI Extension Project");
    expect(patterns.some(pattern => pattern.startsWith("Monorepo"))).toBe(true);
  });

  it("detects a nested Node package and its full stack", async () => {
    const directory = createDirectory();
    const app = join(directory, "app");
    mkdirSync(app);
    writeFileSync(join(app, "tsconfig.json"), "{}");
    writeFileSync(join(app, "yarn.lock"), "");
    writeFileSync(join(app, "package.json"), JSON.stringify({
      scripts: { test: "vitest" },
      dependencies: {
        next: "1", react: "1", prisma: "1", tailwindcss: "1",
        "@azure/functions": "1", vitest: "1",
      },
    }));

    await expect(NodeDetector.detect(directory)).resolves.toMatchObject({
      language: "TypeScript",
      framework: "Next.js",
      orm: "Prisma",
      styling: "Tailwind CSS",
      cloud: "Azure Functions",
      testing: "Vitest",
      packageManager: "yarn",
      scripts: ["test"],
    });
  });

  it("returns an empty Node context for malformed package metadata", async () => {
    const directory = createDirectory();
    writeFileSync(join(directory, "package.json"), "{");
    await expect(NodeDetector.detect(directory)).resolves.toEqual({});
  });

  it("detects Python framework, ORM, and test runner", async () => {
    const directory = createDirectory();
    writeFileSync(join(directory, "requirements.txt"), "fastapi\nsqlalchemy\npytest\n");
    await expect(PythonDetector.detect(directory)).resolves.toMatchObject({
      language: "Python",
      framework: "FastAPI",
      orm: "SQLAlchemy",
      testing: "Pytest",
      isTypeScript: false,
    });
  });
});
