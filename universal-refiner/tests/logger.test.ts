import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RuntimeLogger } from "../src/core/logger.js";

describe("RuntimeLogger", () => {
  let directory: string;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "promptimprover-logger-"));
    process.env.PROMPT_REFINER_GLOBAL_DIR = directory;
    delete process.env.PROMPT_REFINER_LOG_LEVEL;
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    delete process.env.PROMPT_REFINER_LOG_LEVEL;
    fs.rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes enabled levels and suppresses levels below the configured threshold", () => {
    process.env.PROMPT_REFINER_LOG_LEVEL = "warn";
    RuntimeLogger.debug("hidden debug");
    RuntimeLogger.info("hidden info");
    RuntimeLogger.warn("visible warn");
    RuntimeLogger.error("visible error");

    const log = fs.readFileSync(path.join(directory, "runtime.log"), "utf8");
    expect(log).not.toContain("hidden");
    expect(log).toContain("[WARN] visible warn");
    expect(log).toContain("[ERROR] visible error");
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("suppresses warn below the error threshold while always recording errors", () => {
    process.env.PROMPT_REFINER_LOG_LEVEL = "error";
    RuntimeLogger.warn("hidden warn");
    expect(fs.existsSync(path.join(directory, "runtime.log"))).toBe(false);

    process.env.PROMPT_REFINER_LOG_LEVEL = "error";
    RuntimeLogger.error("visible error");
    expect(fs.readFileSync(path.join(directory, "runtime.log"), "utf8")).toContain("visible error");
  });

  it("defaults invalid levels to info and serializes every metadata shape", () => {
    process.env.PROMPT_REFINER_LOG_LEVEL = "INVALID";
    RuntimeLogger.debug("hidden");
    RuntimeLogger.info("none");
    RuntimeLogger.info("string", "detail");
    RuntimeLogger.info("object", { ready: true });
    const errorWithoutStack = new Error("failure");
    errorWithoutStack.stack = "";
    RuntimeLogger.info("error", errorWithoutStack);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    RuntimeLogger.info("circular", circular);

    const log = fs.readFileSync(path.join(directory, "runtime.log"), "utf8");
    expect(log).toContain("[INFO] none");
    expect(log).toContain("string | detail");
    expect(log).toContain('object | {"ready":true}');
    expect(log).toContain("error | Error: failure");
    expect(log).toContain("circular | [object Object]");
  });

  it("uses the home default and continues when file output fails", () => {
    const originalProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = directory;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    process.env.PROMPT_REFINER_LOG_LEVEL = "DEBUG";
    const blockedPath = path.join(os.homedir(), ".refiner");
    fs.writeFileSync(blockedPath, "not a directory");

    RuntimeLogger.debug("still rendered", new Error("with stack"));

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] still rendered"));
    process.env.USERPROFILE = originalProfile;
  });
});
