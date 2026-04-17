import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ConfigManager } from "../src/core/config.js";

describe("ConfigManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should load mandates from .gemini-refiner.json", () => {
    const config = {
      mandates: ["Always use tabs", "Write JSDoc for all functions"]
    };
    fs.writeFileSync(path.join(tmpDir, ".gemini-refiner.json"), JSON.stringify(config));

    const loaded = ConfigManager.loadConfig(tmpDir);
    expect(loaded.mandates).toContain("Always use tabs");
    expect(loaded.mandates).toHaveLength(2);
  });

  it("should return empty object if config missing", () => {
    const loaded = ConfigManager.loadConfig(tmpDir);
    expect(loaded).toEqual({});
  });
});
