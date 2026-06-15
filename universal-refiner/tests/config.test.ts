import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ConfigManager } from "../src/core/config.js";
import { AgenticBlackboard } from "../src/core/blackboard.js";

describe("ConfigManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("rejects every invalid semantic override boundary", () => {
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({
      semantic: {
        localEnabled: "yes" as unknown as boolean,
        mcpSamplingEnabled: 1 as unknown as boolean,
        baseUrl: 42 as unknown as string,
        models: [],
        timeoutMs: Number.POSITIVE_INFINITY,
        temperature: -1,
        allowNonLoopback: null as unknown as boolean,
      },
    });

    expect(ConfigManager.getSemanticConfig(tmpDir)).toEqual({
      localEnabled: true,
      mcpSamplingEnabled: true,
      baseUrl: "http://localhost:9000/v1",
      models: ["gemma3:12b", "gemma3:1b"],
      timeoutMs: 120000,
      temperature: 0.2,
      allowNonLoopback: false,
    });
  });

  it.each([
    [[""], "blank model"],
    [["valid", " "], "one blank model"],
    ["not-an-array", "non-array models"],
  ])("rejects %s", (models) => {
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({
      semantic: { models: models as unknown as string[] },
    });

    expect(ConfigManager.getSemanticConfig(tmpDir).models).toEqual(["gemma3:12b", "gemma3:1b"]);
  });

  it.each([
    [{ timeoutMs: "fast" as unknown as number }, "non-number timeout"],
    [{ timeoutMs: 0 }, "zero timeout"],
    [{ temperature: Number.NaN }, "non-finite temperature"],
    [{ temperature: -0.1 }, "negative temperature"],
  ])("rejects %s", (semantic) => {
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({ semantic });

    const config = ConfigManager.getSemanticConfig(tmpDir);
    expect(config.timeoutMs).toBe(120000);
    expect(config.temperature).toBe(0.2);
  });

  it("uses default-path overloads without requiring a config file", () => {
    expect(ConfigManager.loadConfig()).toEqual({});
    expect(ConfigManager.getSemanticConfig()).toMatchObject({
      localEnabled: true,
      mcpSamplingEnabled: true,
    });
  });

  it("derives supported predictive mandates and ignores unsupported recurring keywords", () => {
    vi.spyOn(AgenticBlackboard, "getLogs").mockReturnValue([
      { timestamp: "", message: "test security doc performance error refactor" },
      { timestamp: "", message: "TEST SECURITY DOC PERFORMANCE ERROR REFACTOR" },
      { timestamp: "", message: "test security doc performance error refactor" },
      { timestamp: "", message: "unrelated" },
    ]);

    expect(ConfigManager.getPredictiveMandates()).toEqual([
      "Predictive: You've asked for tests in 30% of recent prompts. Ensure comprehensive testing.",
      "Predictive: Security is a recurring theme. Apply OWASP principles strictly.",
      "Predictive: Frequent documentation requests detected. Ensure JSDoc/README updates.",
    ]);
  });

  it("only considers the ten most recent logs and requires three keyword matches", () => {
    vi.spyOn(AgenticBlackboard, "getLogs").mockReturnValue([
      { timestamp: "", message: "test" },
      { timestamp: "", message: "test" },
      ...Array.from({ length: 8 }, () => ({ timestamp: "", message: "unrelated" })),
      { timestamp: "", message: "test security doc" },
      { timestamp: "", message: "security doc" },
      { timestamp: "", message: "security doc" },
    ]);

    expect(ConfigManager.getPredictiveMandates()).toEqual([]);
  });
});
