import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchitecturalScout, NodeDetector, PythonDetector, type ProjectContext } from "../src/detectors/project-scout.js";
import { comparePrompts, createABEvaluationRecord, evaluatePrompt } from "../src/evaluation/prompt-evaluator.js";
import { PromptLinter } from "../src/linters/prompt-linter.js";
import { LocalBrain } from "../src/memory/local-brain.js";
import { NeuralSnippets } from "../src/memory/neural-snippets.js";
import { PromptOptimizer } from "../src/refiners/prompt-optimizer.js";
import { PromptRefiner } from "../src/refiners/prompt-refiner.js";
import { ApprovedTemplateSelector, type PromptTemplateCandidate } from "../src/refiners/template-selector.js";
import { FileWatcher, MEANINGFUL_EXTENSIONS, NOISE_PATH_SEGMENTS, NOISE_SUFFIXES } from "../src/watcher/file-watcher.js";

const directories: string[] = [];

function tempDir(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function writeJson(directory: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(value));
}

afterEach(() => {
  vi.restoreAllMocks();
  NeuralSnippets.reset();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("LocalBrain failure and update behavior", () => {
  it("creates storage, handles missing pattern arrays, and updates existing patterns", () => {
    const directory = tempDir("brain-");
    expect(LocalBrain.getPatterns(directory)).toEqual([]);

    const storage = path.join(directory, ".refiner", "memory.json");
    fs.writeFileSync(storage, "{}");
    expect(LocalBrain.getPatterns(directory, true)).toEqual([]);
    expect(() => LocalBrain.savePattern({ id: "migrated", category: "quality", description: "migrated" }, directory)).not.toThrow();
    expect(LocalBrain.getPatterns(directory, true)).toMatchObject([{ id: "migrated" }]);
    fs.writeFileSync(storage, "{}");
    expect(() => LocalBrain.approvePattern("missing", directory)).not.toThrow();

    fs.writeFileSync(storage, JSON.stringify({ patterns: [] }));
    LocalBrain.savePattern({ id: "one", category: "quality", description: "first", isProposed: true }, directory);
    LocalBrain.savePattern({ id: "one", category: "quality", description: "updated" }, directory);
    expect(LocalBrain.getPatterns(directory, true)).toMatchObject([{ id: "one", description: "updated" }]);

    LocalBrain.approvePattern("missing", directory);
    expect(LocalBrain.getPatterns(directory, true)).toHaveLength(1);
  });

  it("returns an empty list for corrupt storage and surfaces corrupt writes", () => {
    const directory = tempDir("brain-corrupt-");
    LocalBrain.getPatterns(directory);
    const storage = path.join(directory, ".refiner", "memory.json");
    fs.writeFileSync(storage, "{");

    expect(LocalBrain.getPatterns(directory)).toEqual([]);
    expect(() => LocalBrain.savePattern({ id: "bad", category: "test", description: "bad" }, directory)).toThrow();
    expect(() => LocalBrain.approvePattern("bad", directory)).toThrow();
  });
});

describe("NeuralSnippets traversal, parsing, and ranking behavior", () => {
  it("walks only meaningful source files and handles missing roots", async () => {
    const directory = tempDir("snippets-walk-");
    for (const ignored of ["node_modules", "dist", "build", "out", "coverage", "tests", "test", ".hidden"]) {
      fs.mkdirSync(path.join(directory, ignored));
      fs.writeFileSync(path.join(directory, ignored, "ignored.ts"), "export function ignored() {}");
    }
    fs.writeFileSync(path.join(directory, "kept.ts"), "export function kept() {}");
    fs.mkdirSync(path.join(directory, "nested"));
    fs.writeFileSync(path.join(directory, "nested", "nested.js"), "export function nested() {}");
    fs.writeFileSync(path.join(directory, "ignored.test.ts"), "export function ignoredTest() {}");
    fs.writeFileSync(path.join(directory, "ignored.spec.js"), "export function ignoredSpec() {}");
    fs.writeFileSync(path.join(directory, "ignored.md"), "not source");

    await NeuralSnippets.initialize(path.join(directory, "missing"));
    expect(NeuralSnippets.isInitialized).toBe(true);

    NeuralSnippets.reset();
    await NeuralSnippets.initialize(directory);
    expect(await NeuralSnippets.search("kept", directory)).toMatchObject([{ symbolName: "kept" }]);
    expect(await NeuralSnippets.search("ignored", directory)).toEqual([]);
    await NeuralSnippets.initialize(directory);
  });

  it("extracts JavaScript-style blocks at closing, safety, and maximum-length boundaries", () => {
    const extract = (NeuralSnippets as any).extractSymbolBlock.bind(NeuralSnippets);
    expect(extract(["function short() {", "  return true;", "}"], 0, "ts")).toContain("}");
    expect(extract(["declaration", "one", "two", "three", "four", "five", "six"], 0, "ts").split("\n")).toHaveLength(6);
    const long = ["function long() {", ...Array.from({ length: 55 }, () => "  work();")];
    expect(extract(long, 0, "ts").split("\n")).toHaveLength(51);
  });

  it("extracts Python indentation boundaries and all named TypeScript symbol types", async () => {
    const directory = tempDir("snippets-symbols-");
    fs.writeFileSync(path.join(directory, "symbols.py"), [
      "class Service:",
      "    def run(self):",
      "        return True",
      "",
      "def helper():",
      "    return False",
      "after = 1",
    ].join("\n"));
    fs.writeFileSync(path.join(directory, "symbols.ts"), [
      "export interface Contract { value: string }",
      "export type Alias = string;",
      "export default class {}",
      "export default function () {}",
      "export function searchableOne() {}",
      "export function searchableTwo() {}",
      `export const longText = "${"searchable ".repeat(30)}";`,
    ].join("\n"));

    await NeuralSnippets.initialize(directory);
    expect((await NeuralSnippets.search("Contract", directory))[0]?.symbolType).toBe("interface");
    expect((await NeuralSnippets.search("Alias", directory))[0]?.symbolType).toBe("type");
    expect((await NeuralSnippets.search("helper", directory))[0]?.content).not.toContain("after = 1");
    expect(["chunk", "function"]).toContain((await NeuralSnippets.search("searchable", directory, 1))[0]?.symbolType);
    expect(await NeuralSnippets.search("missing", directory)).toEqual([]);
    expect(await NeuralSnippets.search("searchable", directory, 1)).toHaveLength(1);
  });

  it("defensively indexes unnamed symbols and ranks unique symbols before chunks", async () => {
    const directory = tempDir("snippets-ranking-");
    fs.writeFileSync(path.join(directory, "source.ts"), "export const value = 1;");
    const originalParse = (NeuralSnippets as any).parseSymbols;
    (NeuralSnippets as any).parseSymbols = () => [{ content: "unnamed symbol", symbolType: "function" }];
    await NeuralSnippets.initialize(directory);
    (NeuralSnippets as any).parseSymbols = originalParse;

    (NeuralSnippets as any).store = new Map([
      [1, { id: 1, filePath: "a.ts", content: "symbol", symbolName: "symbol", symbolType: "function" }],
      [2, { id: 2, filePath: "a.ts", content: "chunk", symbolType: "chunk" }],
    ]);
    (NeuralSnippets as any).symbolIndex = { search: vi.fn().mockResolvedValueOnce([1, 1, 999]).mockResolvedValue(null) };
    (NeuralSnippets as any).contentIndex = { search: vi.fn().mockResolvedValueOnce([1, 2, 999]).mockResolvedValue(null) };
    (NeuralSnippets as any).isInitialized = true;

    expect(await NeuralSnippets.search("symbol extra", directory)).toEqual([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 }),
    ]);
  });
});

describe("project detector fallbacks and precedence", () => {
  it("covers empty, modular, git, nested fallback, and unreadable architecture roots", async () => {
    expect(await ArchitecturalScout.detectPatterns(path.join(tempDir("arch-missing-"), "missing"))).toEqual([]);

    const modular = tempDir("arch-modular-");
    fs.mkdirSync(path.join(modular, "src"));
    fs.mkdirSync(path.join(modular, ".git"));
    writeJson(modular, {});
    expect(await ArchitecturalScout.detectPatterns(modular)).toEqual(expect.arrayContaining([
      "Modular TypeScript/Node Project",
      "Git Repository",
    ]));

    const nested = tempDir("arch-nested-");
    fs.mkdirSync(path.join(nested, ".hidden"));
    fs.mkdirSync(path.join(nested, "module"));
    fs.mkdirSync(path.join(nested, "module", "src"));
    expect(await ArchitecturalScout.detectPatterns(nested)).toContain("Multi-Module (module)");

    const nestedPackage = tempDir("arch-nested-package-");
    fs.mkdirSync(path.join(nestedPackage, "module"));
    writeJson(path.join(nestedPackage, "module"), {});
    expect(await ArchitecturalScout.detectPatterns(nestedPackage)).toContain("Multi-Module (module)");

    const monorepo = tempDir("arch-hidden-monorepo-");
    for (const name of [".hidden", "packages", "one", "two"]) fs.mkdirSync(path.join(monorepo, name));
    expect((await ArchitecturalScout.detectPatterns(monorepo))[0]).not.toContain(".hidden");

    const file = path.join(tempDir("arch-file-"), "file");
    fs.writeFileSync(file, "");
    expect(await ArchitecturalScout.detectPatterns(file)).toEqual([]);
  });

  it("detects all Node alternatives, package managers, and empty metadata", async () => {
    const none = tempDir("node-none-");
    fs.mkdirSync(path.join(none, ".hidden"));
    fs.mkdirSync(path.join(none, "empty"));
    expect(await NodeDetector.detect(none)).toEqual({});

    const npmProject = tempDir("node-npm-");
    fs.writeFileSync(path.join(npmProject, "package-lock.json"), "");
    writeJson(npmProject, {
      dependencies: {
        express: "1", hono: "1", "@nestjs/core": "1", react: "1", next: "1",
        prisma: "1", "drizzle-orm": "1", typeorm: "1", sequelize: "1",
        tailwindcss: "1", "styled-components": "1",
        "@azure/functions": "1", "@aws-sdk/client-lambda": "1",
        jest: "1", vitest: "1", cypress: "1",
      },
    });
    expect(await NodeDetector.detect(npmProject)).toMatchObject({
      language: "JavaScript",
      framework: "Next.js",
      orm: "Sequelize",
      styling: "Styled Components",
      cloud: "AWS Lambda",
      testing: "Cypress",
      packageManager: "npm",
      scripts: [],
    });

    const honoProject = tempDir("node-hono-");
    writeJson(honoProject, { dependencies: { hono: "1" } });
    expect(await NodeDetector.detect(honoProject)).toMatchObject({ framework: "Hono", packageManager: "pnpm" });
  });

  it("covers Python absence, read failures, and all detection alternatives", async () => {
    const absent = tempDir("python-absent-");
    expect(await PythonDetector.detect(absent)).toEqual({});

    const unreadable = tempDir("python-unreadable-");
    fs.mkdirSync(path.join(unreadable, "requirements.txt"));
    expect(await PythonDetector.detect(unreadable)).toEqual({ language: "Python", isTypeScript: false });

    const project = tempDir("python-all-");
    fs.writeFileSync(path.join(project, "requirements.txt"), "fastapi\ndjango\nflask\nsqlalchemy\ntortoise-orm\npeewee\npytest\nunittest");
    fs.writeFileSync(path.join(project, "pyproject.toml"), "");
    expect(await PythonDetector.detect(project)).toMatchObject({
      framework: "Flask",
      orm: "Peewee",
      testing: "Unittest",
    });
  });
});

describe("PromptLinter complete context behavior", () => {
  it("adds every context-aware gap and de-duplicates merged semantic gaps", () => {
    const context: ProjectContext = {
      language: "Unknown", framework: "Unknown", testing: "Unknown", isTypeScript: false,
      orm: "Prisma", styling: "Tailwind CSS", cloud: "Azure Functions",
    };
    const gaps = PromptLinter.lint("refactor entire system module", context);
    expect(gaps.map(gap => gap.id)).toEqual([
      "testing", "tech-stack", "architecture", "documentation", "security",
      "orm-context", "styling-context", "cloud-context",
    ]);
    expect(PromptLinter.mergeGaps(gaps, [gaps[0], { id: "semantic", message: "m", suggestedAction: "a" }]))
      .toHaveLength(gaps.length + 1);
  });

  it("adds no gaps when all requirements and context details are explicit", () => {
    const context: ProjectContext = {
      language: "Unknown", framework: "Unknown", testing: "Unknown", isTypeScript: false,
      orm: "Prisma", styling: "Tailwind CSS", cloud: "Azure Functions",
    };
    expect(PromptLinter.lint(
      "Using framework language architecture pattern: test docs comments readme error handling security schema migration model class style responsive trigger handler env",
      context,
    )).toEqual([]);
  });
});

describe("PromptRefiner optional context behavior", () => {
  it("renders every optional context section, mandate, and prompt id", () => {
    const context: ProjectContext = {
      language: "TypeScript", framework: "Unknown", testing: "Unknown", isTypeScript: true,
      orm: "Prisma", styling: "Tailwind CSS", cloud: "Azure Functions", packageManager: "npm",
      architecturalPatterns: ["Clean Architecture / DDD", "Modern Component-Based Architecture (React/Vue style)", "MVC (Model-View-Controller)"],
      learnedPatterns: [{ id: "pattern", category: "quality", description: "Preserve behavior", learnedAt: "now" }],
      relevantSnippets: [
        { id: 1, filePath: "src/a.ts", content: " function a() {} ", symbolName: "a", symbolType: "function" },
        { id: 2, filePath: "src/b.ts", content: " chunk content ", symbolType: "chunk" },
      ],
      customMandates: ["Use strict types"],
      predictiveLessons: [{ title: "Regression", summary: "Add tests", confidence: 0.9 }],
    };
    const output = PromptRefiner.refine("Implement feature", context, { size: "small" }, "prompt-1");
    expect(output).toContain("[PROMPT_ID: prompt-1]");
    expect(output).toContain("ORM/Database");
    expect(output).toContain("MVC Mandate");
    expect(output).toContain("[chunk]");
    expect(output).toContain("Predictive Autonomous Lessons");
    expect(output).toContain("industry standards");
    expect(PromptRefiner.calculateGain("", "", context)).toBe(85);

    expect(PromptRefiner.refine("Task", context, {}, undefined, {
      approvedTemplates: [{
        id: "template", category: "feature", title: "No notes", templateText: "Implement.", relevanceScore: 1, selectionReasons: [],
      }],
    })).not.toContain("Usage notes:");
  });
});

describe("PromptOptimizer fallback branches", () => {
  it("handles absent optional context, zero iterations, and an empty fallback rewrite", async () => {
    const context: ProjectContext = { language: "Unknown", framework: "Unknown", testing: "Unknown", isTypeScript: false };
    const request = vi.fn()
      .mockResolvedValueOnce("Here is the rewritten")
      .mockResolvedValueOnce("   ");
    expect(await new PromptOptimizer(request).optimize("Original", context, 1)).toBe("Here is the rewritten");
    expect(await new PromptOptimizer(request).optimize("Original", {
      ...context,
      relevantSnippets: [{ id: 1, filePath: "a.ts", content: "content", symbolType: "chunk" }],
    }, 1)).toBe("");
    expect(await new PromptOptimizer(request).optimize("Original", context, 0)).toBe("Original");
  });
});

describe("ApprovedTemplateSelector edge ranking behavior", () => {
  it("infers each category and clamps malformed scores and lengths", async () => {
    const longText = "x".repeat(4_100);
    const candidates: PromptTemplateCandidate[] = [
      { id: "high", repoId: "r", category: "bugfix", title: "Fix failure", templateText: longText, usageNotes: longText, successScore: 200, approved: true },
      { id: "low", repoId: "r", category: "test", title: "Test", templateText: "verify", successScore: -1, approved: 1 },
      { id: "nan", repoId: "r", category: "refactor", title: "Cleanup", templateText: "simplify", successScore: Number.NaN, approved: 1 },
      { id: "feature", repoId: "r", category: "feature", title: "Build", templateText: "create", successScore: 0, approved: 1 },
    ];
    const selector = new ApprovedTemplateSelector({ getTemplates: async () => candidates });

    expect((await selector.select({ repoId: "r", prompt: "fix bug error failure", category: " BUGFIX ", limit: 99 }))[0])
      .toMatchObject({ id: "high", relevanceScore: 75 });
    expect((await selector.select({ repoId: "r", prompt: "fix defect" }))[0].selectionReasons).toContain("category:bugfix");
    expect((await selector.select({ repoId: "r", prompt: "tests coverage verification" }))
      .find(item => item.category === "test")?.selectionReasons).toContain("category:test");
    expect((await selector.select({ repoId: "r", prompt: "refactor cleanup restructure" }))
      .find(item => item.category === "refactor")?.selectionReasons).toContain("category:refactor");
    expect((await selector.select({ repoId: "r", prompt: "add build create implement feature" }))
      .find(item => item.category === "feature")?.selectionReasons).toContain("category:feature");
    const unspecified = await selector.select({ repoId: "r", prompt: "", limit: 10 });
    expect(unspecified.find(item => item.id === "high")?.templateText).toHaveLength(4_000);
    expect(unspecified.find(item => item.id === "high")?.usageNotes).toHaveLength(4_000);
  });
});

describe("deterministic evaluation edge behavior", () => {
  it("covers empty intent, original/tie preferences, generated timestamps, and observed outcome ties", () => {
    expect(evaluatePrompt("", "").dimensions.intentPreservation.evidence).toEqual(["empty-baseline"]);
    expect(comparePrompts("Fix src/a.ts with tests", "fix").heuristicPreference).toBe("original");
    expect(comparePrompts("same", "same").heuristicPreference).toBe("tie");
    expect(createABEvaluationRecord({
      experimentId: "heuristic-a", baselinePrompt: "fix",
      variantA: { id: "A", prompt: "Fix src/a.ts with tests and verify results" },
      variantB: { id: "B", prompt: "fix" },
    }).heuristicPreference).toBe("A");

    const completeA = createABEvaluationRecord({
      experimentId: "a", baselinePrompt: "", variantA: { id: "A", prompt: "", observedOutcome: { status: "completed" } },
      variantB: { id: "B", prompt: "", observedOutcome: { status: "cancelled", testsPassed: 100, testsFailed: 1, reworkCount: 1 } },
    });
    expect(completeA.heuristicPreference).toBe("tie");
    expect(completeA.observedWinner).toBe("A");
    expect(completeA.createdAt).toBeTruthy();

    const tie = createABEvaluationRecord({
      experimentId: "tie", baselinePrompt: "x",
      variantA: { id: "A", prompt: "x", observedOutcome: { status: "failed" } },
      variantB: { id: "B", prompt: "x", observedOutcome: { status: "failed" } },
    });
    expect(tie.observedWinner).toBeUndefined();
  });
});

describe("FileWatcher lifecycle and filtering behavior", () => {
  it("covers idempotent lifecycle, error forwarding, unlink, and all in-process filters", async () => {
    expect(MEANINGFUL_EXTENSIONS.has(".prompt")).toBe(true);
    expect(NOISE_PATH_SEGMENTS).toContain("coverage");
    expect(NOISE_SUFFIXES).toContain(".tmp");

    const watcher = new FileWatcher(tempDir("watcher-unit-"));
    watcher.start();
    watcher.start();
    const inner = (watcher as any).inner as EventEmitter;

    const errors: Error[] = [];
    const changes: unknown[] = [];
    watcher.on("error", error => errors.push(error));
    watcher.on("change", event => changes.push(event));
    inner.emit("error", "failure");
    inner.emit("error", new Error("typed failure"));
    expect(errors[0]).toEqual(new Error("failure"));
    expect(errors[1]).toEqual(new Error("typed failure"));

    for (const noisy of ["C:\\repo\\node_modules\\a.ts", "/repo/coverage/a.ts", "/repo/a.log", "/repo/a.bin", "/repo/no-extension"]) {
      (watcher as any).emitChange("change", noisy);
    }
    inner.emit("unlink", "/repo/a.md");
    expect(changes).toHaveLength(1);
    await watcher.stop();
    await watcher.stop();
  });
});
