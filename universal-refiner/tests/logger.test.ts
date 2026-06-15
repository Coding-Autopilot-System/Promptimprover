import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RuntimeLogger } from "../src/core/logger.js";
import { REDACTED, containsSensitiveContent, isSensitiveFilename, redact, redactString } from "../src/core/redaction.js";

describe("redaction", () => {
  it("redacts free-form assignments, authorization values, and URL secrets", () => {
    const value = redactString("password=hunter2 Bearer abc.def https://user:pass@example.com/a?token=abc&safe=yes");

    expect(value).not.toContain("hunter2");
    expect(value).not.toContain("abc.def");
    expect(value).not.toContain("user");
    expect(value).not.toContain(":pass@");
    expect(value).not.toContain("token=abc");
    expect(value).toContain("safe=yes");
    expect(redactString("OPENAI_API_KEY=provider-secret")).toBe(`OPENAI_API_KEY=${REDACTED}`);
    expect(redactString("http://%")).toBe("http://%");
  });

  it("recursively redacts secret keys, errors, cycles, arrays, and hostile objects", () => {
    const circular: { token: string; self?: unknown } = { token: "hidden" };
    circular.self = circular;
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("hidden"); } });
    const error = new Error("password=hidden");
    error.stack = "";

    expect(redact({ apiKey: "hidden", "x-api-key": "hidden", aws_secret_access_key: "hidden", nested: ["safe", circular], error, hostile, count: 1, empty: null })).toEqual({
      apiKey: REDACTED,
      "x-api-key": REDACTED,
      aws_secret_access_key: REDACTED,
      nested: ["safe", { token: REDACTED, self: "[Circular]" }],
      error: { name: "Error", message: `password=${REDACTED}`, stack: "" },
      hostile: REDACTED,
      count: 1,
      empty: null,
    });
  });

  it("identifies sensitive filenames and credential-bearing content", () => {
    expect(isSensitiveFilename("config/credentials.ts")).toBe(true);
    expect(isSensitiveFilename("src/service.ts")).toBe(false);
    expect(isSensitiveFilename("")).toBe(false);
    expect(containsSensitiveContent("const key = process.env.API_KEY")).toBe(false);
    expect(containsSensitiveContent("interface Login { password: string }")).toBe(false);
    expect(containsSensitiveContent("Authorization: Basic abc123")).toBe(true);
    expect(containsSensitiveContent("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(containsSensitiveContent('apiKey: "literal-secret"')).toBe(true);
    expect(containsSensitiveContent("token=abcdefghijklmnop")).toBe(true);
    expect(containsSensitiveContent('AZURE_CLIENT_SECRET="provider-secret"')).toBe(true);
    expect(containsSensitiveContent("https://user:pass@example.com")).toBe(true);
  });
});

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
    RuntimeLogger.info("bigint", 1n);
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
    expect(log).toContain("bigint | 1");
    expect(log).toContain('error | {"name":"Error","message":"failure","stack":""}');
    expect(log).toContain('circular | {"self":"[Circular]"}');
  });

  it("redacts secrets from messages, string metadata, nested metadata, and errors", () => {
    RuntimeLogger.info("token=message-secret", "password=string-secret");
    RuntimeLogger.warn("nested", { auth: { access_token: "nested-secret" }, safe: "visible" });
    RuntimeLogger.error("failure", new Error("api_key=error-secret"));

    const log = fs.readFileSync(path.join(directory, "runtime.log"), "utf8");
    expect(log).not.toMatch(/message-secret|string-secret|nested-secret|error-secret/);
    expect(log).toContain(REDACTED);
    expect(log).toContain("visible");
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringMatching(/message-secret|string-secret|nested-secret|error-secret/));
  });

  it("uses the home default and continues when file output fails", () => {
    const originalProfile = process.env.USERPROFILE;
    const originalHome = process.env.HOME;
    process.env.USERPROFILE = directory;
    process.env.HOME = directory;
    delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    process.env.PROMPT_REFINER_LOG_LEVEL = "DEBUG";
    const blockedPath = path.join(directory, ".refiner");
    fs.writeFileSync(blockedPath, "not a directory");

    RuntimeLogger.debug("still rendered", new Error("with stack"));

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] still rendered"));
    if (originalProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalProfile;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });
});
