const fs = require("fs");
const path = require("path");

const outPath = path.join(__dirname, "coverage-gaps.test.ts");
const source = `import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("ConfigManager gap coverage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-gap-"));
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty object when the repository config contains invalid JSON", async () => {
    const { ConfigManager } = await import("../src/core/config.js");
    fs.writeFileSync(path.join(tmpDir, ".gemini-refiner.json"), "{ NOT VALID JSON }");

    expect(ConfigManager.loadConfig(tmpDir)).toEqual({});
  });
});
`;

fs.writeFileSync(outPath, source, "utf8");
console.log(`Wrote ${outPath}`);
