import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { NodeDetector, PythonDetector, ArchitecturalScout } from "../src/detectors/project-scout.js";

describe("Detectors", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "refiner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("NodeDetector", () => {
    it("should detect a TypeScript project with Prisma and Tailwind", async () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        dependencies: { react: "18.0.0", prisma: "5.0.0", tailwindcss: "3.0.0" },
        devDependencies: { vitest: "1.0.0", typescript: "5.0.0" }
      }));
      fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");

      const ctx = await NodeDetector.detect(tmpDir);
      expect(ctx.orm).toBe("Prisma");
      expect(ctx.styling).toBe("Tailwind CSS");
    });

    it("should detect an Express project with Jest", async () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        dependencies: { express: "4.18.0" },
        devDependencies: { jest: "29.0.0" }
      }));

      const ctx = await NodeDetector.detect(tmpDir);
      expect(ctx.language).toBe("JavaScript");
      expect(ctx.framework).toBe("Express");
      expect(ctx.testing).toBe("Jest");
    });
  });

  describe("PythonDetector", () => {
    it("should detect a FastAPI project with Pytest", async () => {
      fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "fastapi\npytest");
      const ctx = await PythonDetector.detect(tmpDir);
      expect(ctx.language).toBe("Python");
      expect(ctx.framework).toBe("FastAPI");
      expect(ctx.testing).toBe("Pytest");
    });

    it("should detect Django from pyproject.toml", async () => {
      fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), '[tool.poetry.dependencies]\ndjango = "^4.0"');
      const ctx = await PythonDetector.detect(tmpDir);
      expect(ctx.framework).toBe("Django");
    });
  });

  describe("ArchitecturalScout", () => {
    it("should detect Clean Architecture / DDD", async () => {
      fs.mkdirSync(path.join(tmpDir, "domain"));
      fs.mkdirSync(path.join(tmpDir, "application"));
      fs.mkdirSync(path.join(tmpDir, "infrastructure"));

      const patterns = await ArchitecturalScout.detectPatterns(tmpDir);
      expect(patterns).toContain("Clean Architecture / DDD");
    });

    it("should detect MVC", async () => {
      fs.mkdirSync(path.join(tmpDir, "models"));
      fs.mkdirSync(path.join(tmpDir, "views"));
      fs.mkdirSync(path.join(tmpDir, "controllers"));

      const patterns = await ArchitecturalScout.detectPatterns(tmpDir);
      expect(patterns).toContain("MVC (Model-View-Controller)");
    });
  });
});
