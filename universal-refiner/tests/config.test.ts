import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("should use quality-first local semantic defaults", () => {
    const config = ConfigManager.getSemanticConfig(tmpDir);
    expect(config.baseUrl).toBe("http://localhost:9000/v1");
    expect(config.models).toEqual(["gemma3:12b", "gemma3:1b"]);
    expect(config.allowNonLoopback).toBe(false);
  });

  it("should merge semantic overrides with safe defaults", () => {
    fs.writeFileSync(path.join(tmpDir, ".gemini-refiner.json"), JSON.stringify({
      semantic: { models: ["gemma3:1b"], timeoutMs: 5000 }
    }));

    const config = ConfigManager.getSemanticConfig(tmpDir);
    expect(config.models).toEqual(["gemma3:1b"]);
    expect(config.timeoutMs).toBe(5000);
    expect(config.allowNonLoopback).toBe(false);
  });

  it("should reject malformed semantic overrides", () => {
    fs.writeFileSync(path.join(tmpDir, ".gemini-refiner.json"), JSON.stringify({
      semantic: { models: [42], timeoutMs: -1, temperature: 99, baseUrl: "" }
    }));

    const config = ConfigManager.getSemanticConfig(tmpDir);
    expect(config.models).toEqual(["gemma3:12b", "gemma3:1b"]);
    expect(config.timeoutMs).toBe(120000);
    expect(config.temperature).toBe(0.2);
    expect(config.baseUrl).toBe("http://localhost:9000/v1");
  });

  it("returns an empty config and reports invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, ".gemini-refiner.json"), "{");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(ConfigManager.loadConfig(tmpDir)).toEqual({});
    expect(error).toHaveBeenCalled();
  });

  it("accepts all bounded semantic overrides", () => {
    fs.writeFileSync(path.join(tmpDir, ".gemini-refiner.json"), JSON.stringify({
      semantic: {
        localEnabled: false,
        mcpSamplingEnabled: false,
        baseUrl: " http://127.0.0.1:1234/v1 ",
        models: [" primary ", " fallback "],
        timeoutMs: 1,
        temperature: 2,
        allowNonLoopback: true,
      },
    }));

    expect(ConfigManager.getSemanticConfig(tmpDir)).toEqual({
      localEnabled: false,
      mcpSamplingEnabled: false,
      baseUrl: "http://127.0.0.1:1234/v1",
      models: ["primary", "fallback"],
      timeoutMs: 1,
      temperature: 2,
      allowNonLoopback: true,
    });
  });
});
