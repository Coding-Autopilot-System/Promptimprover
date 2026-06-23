import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObsidianOrchestrator } from "../src/integrations/obsidian/obsidian-orchestrator.js";
import { ConfigManager } from "../src/core/config.js";
import { EventStore } from "../src/history/event-store.js";
import { RuntimeLogger } from "../src/core/logger.js";
import * as fs from "fs";

vi.mock("fs");
vi.mock("chokidar", () => ({ watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })) }));
vi.mock("flexsearch", () => {
  class MockIndex {
    add = vi.fn();
    search = vi.fn().mockReturnValue([]);
  }
  return { default: { Index: MockIndex } };
});
vi.mock("@lancedb/lancedb", () => ({ connect: vi.fn().mockResolvedValue({ tableNames: vi.fn().mockResolvedValue([]), createTable: vi.fn() }) }));

describe("ObsidianOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RuntimeLogger, "info").mockImplementation(() => {});
    vi.spyOn(RuntimeLogger, "error").mockImplementation(() => {});
    vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/test-vault", syncLessons: true });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readdirSync").mockReturnValue(["concept1.md"] as any);
    vi.spyOn(fs, "readFileSync").mockReturnValue("---\ntype: synthesis\n---\n\n## Title\n- **Type**: principle\n- **Summary**: Test summary\n");
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes watchers and syncs to wiki", async () => {
    await ObsidianOrchestrator.initWatchers("C:/repo");
    expect(ConfigManager.getObsidianConfig).toHaveBeenCalled();
  });

  it("initWatchers returns when Obsidian is not configured", async () => {
    vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
    await expect(ObsidianOrchestrator.initWatchers("C:/repo")).resolves.toBeUndefined();
  });

  it("initWatchers returns when the concepts directory is missing", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    await expect(ObsidianOrchestrator.initWatchers("C:/repo")).resolves.toBeUndefined();
  });

  it("initWatchers closes an existing watcher before replacing it", async () => {
    const previousWatcher = { close: vi.fn().mockResolvedValue(undefined) };
    (ObsidianOrchestrator as any).watcher = previousWatcher;

    await ObsidianOrchestrator.initWatchers("C:/repo");

    expect(previousWatcher.close).toHaveBeenCalled();
  });

  it("reindex returns before initialization", async () => {
    (ObsidianOrchestrator as any).searchIndex = null;
    (ObsidianOrchestrator as any).db = null;

    await expect((ObsidianOrchestrator as any).reindex("C:/test-vault")).resolves.toBeUndefined();
  });

  it("reindex returns when the concepts directory disappears after initialization", async () => {
    (ObsidianOrchestrator as any).searchIndex = { add: vi.fn() };
    (ObsidianOrchestrator as any).db = { tableNames: vi.fn() };
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    await expect((ObsidianOrchestrator as any).reindex("C:/test-vault")).resolves.toBeUndefined();
  });

  it("syncToWiki extracts lessons and writes them to Obsidian", async () => {
    const mockStore = {
      ensureRepository: vi.fn().mockReturnValue({ id: "repo-canonical" }),
      getRecentLessons: vi.fn().mockReturnValue([{ title: "L1", lesson_type: "T", confidence: 0.9, summary: "Sum" }])
    };
    vi.spyOn(EventStore, "getInstance").mockReturnValue(mockStore as any);
    await ObsidianOrchestrator.syncToWiki("C:/repo");
    expect(mockStore.getRecentLessons).toHaveBeenCalledWith("repo-canonical", 50);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("syncToWiki does nothing if syncLessons is false", async () => {
    vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/test-vault", syncLessons: false });
    const mockStore = { ensureRepository: vi.fn(), getRecentLessons: vi.fn() };
    vi.spyOn(EventStore, "getInstance").mockReturnValue(mockStore as any);
    await ObsidianOrchestrator.syncToWiki("C:/repo");
    expect(mockStore.getRecentLessons).not.toHaveBeenCalled();
  });

  it("syncToWiki returns when there are no approved lessons", async () => {
    const mockStore = {
      ensureRepository: vi.fn().mockReturnValue({ id: "repo-canonical" }),
      getRecentLessons: vi.fn().mockReturnValue([])
    };
    vi.spyOn(EventStore, "getInstance").mockReturnValue(mockStore as any);

    await ObsidianOrchestrator.syncToWiki("C:/repo");

    expect(mockStore.getRecentLessons).toHaveBeenCalledWith("repo-canonical", 50);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("syncToWiki creates directory if it does not exist", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false); // mock dir not existing
    const mockStore = {
      ensureRepository: vi.fn().mockReturnValue({ id: "repo-canonical" }),
      getRecentLessons: vi.fn().mockReturnValue([{ title: "L1", lesson_type: "T", confidence: 0.9, summary: "Sum" }])
    };
    vi.spyOn(EventStore, "getInstance").mockReturnValue(mockStore as any);
    await ObsidianOrchestrator.syncToWiki("C:/repo");
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("syncToWiki catches and logs write errors", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const mockStore = {
      ensureRepository: vi.fn().mockReturnValue({ id: "repo-canonical" }),
      getRecentLessons: vi.fn().mockReturnValue([{ title: "L1", lesson_type: "T", confidence: 0.9, summary: "Sum" }])
    };
    vi.spyOn(EventStore, "getInstance").mockReturnValue(mockStore as any);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("sync error"); });
    await ObsidianOrchestrator.syncToWiki("C:/repo");
    expect(RuntimeLogger.error).toHaveBeenCalledWith("Failed to sync to Obsidian Wiki", expect.any(Error));
  });

  it("initWatchers adds data to existing LanceDB table", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mockTable = { add: vi.fn() };
    (lancedb.connect as any).mockResolvedValueOnce({
      tableNames: vi.fn().mockResolvedValue(["wiki_concepts"]),
      openTable: vi.fn().mockResolvedValue(mockTable),
      createTable: vi.fn()
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["concept1.md"] as any);
    vi.spyOn(fs, "readFileSync").mockReturnValue("content");
    await ObsidianOrchestrator.initWatchers("C:/repo");
    await new Promise(r => setTimeout(r, 50));
    expect(mockTable.add).toHaveBeenCalled();
  });

  it("initWatchers catches and logs LanceDB reindex errors", async () => {
    const lancedb = await import("@lancedb/lancedb");
    (lancedb.connect as any).mockResolvedValueOnce({
      tableNames: vi.fn().mockResolvedValue([]),
      createTable: vi.fn().mockRejectedValue(new Error("lancedb error"))
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["concept1.md"] as any);
    vi.spyOn(fs, "readFileSync").mockReturnValue("content");
    await ObsidianOrchestrator.initWatchers("C:/repo");
    await new Promise(r => setTimeout(r, 50));
    expect(RuntimeLogger.error).toHaveBeenCalledWith("LanceDB reindex failed", expect.any(Error));
  });

  it("initWatchers skips LanceDB writes when there are no markdown files", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const createTable = vi.fn();
    (lancedb.connect as any).mockResolvedValueOnce({
      tableNames: vi.fn().mockResolvedValue([]),
      createTable
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue([] as any);

    await ObsidianOrchestrator.initWatchers("C:/repo");
    await new Promise(r => setTimeout(r, 50));

    expect(createTable).not.toHaveBeenCalled();
  });

  it("initWatchers listens to chokidar changes and triggers reindex", async () => {
    const chokidar = await import("chokidar");
    let changeCb: any;
    (chokidar.watch as any).mockReturnValue({
      on: vi.fn((event, cb) => {
        if (event === "change") changeCb = cb;
      }),
      close: vi.fn()
    });

    await ObsidianOrchestrator.initWatchers("C:/repo");
    expect(changeCb).toBeDefined();
    
    changeCb("C:/repo/test.md");
    expect(RuntimeLogger.info).toHaveBeenCalledWith(expect.stringContaining("Detected change"));
  });

  it("initWatchers catches lancedb.connect errors", async () => {
    const lancedb = await import("@lancedb/lancedb");
    (lancedb.connect as any).mockRejectedValueOnce(new Error("connect error"));
    await ObsidianOrchestrator.initWatchers("C:/repo");
    expect(RuntimeLogger.error).toHaveBeenCalledWith("Failed to initialize LanceDB", expect.any(Error));
  });

  it("getGlobalPatterns parses and returns global patterns", () => {
    const patterns = ObsidianOrchestrator.getGlobalPatterns("C:/repo");
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].description).toBe("Test summary");
  });

  it("getGlobalPatterns returns empty when Obsidian is not configured", () => {
    vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
    expect(ObsidianOrchestrator.getGlobalPatterns("C:/repo")).toEqual([]);
  });

  it("getGlobalPatterns returns empty when concepts directory is missing", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(ObsidianOrchestrator.getGlobalPatterns("C:/repo")).toEqual([]);
  });

  it("getGlobalPatterns defaults category when a type field is missing", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("## Title\n- **Summary**: Test summary\n");
    expect(ObsidianOrchestrator.getGlobalPatterns("C:/repo")[0].category).toBe("general");
  });

  it("getGlobalPatterns ignores sections without summaries", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("## Title\nNo summary here\n");
    expect(ObsidianOrchestrator.getGlobalPatterns("C:/repo")).toEqual([]);
  });

  it("logActivity appends logs and updates hot cache", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    await ObsidianOrchestrator.logActivity("C:/repo", "test summary", "test rationale");
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("logActivity returns early when Obsidian is not configured", async () => {
    vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
    await expect(ObsidianOrchestrator.logActivity("C:/repo", "test summary")).resolves.toBeUndefined();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("updateHotCache modifies hot.md", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("# Recent Context\n\n## Key Recent Facts\n- old line");
    await ObsidianOrchestrator.updateHotCache("C:/repo", "new fact");
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("updateHotCache returns early when Obsidian is not configured", async () => {
    vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
    await expect(ObsidianOrchestrator.updateHotCache("C:/repo", "new fact")).resolves.toBeUndefined();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("updateHotCache creates a facts section when the scaffolded file only has the main header", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("# Recent Context");

    await ObsidianOrchestrator.updateHotCache("C:/repo", "new fact");

    const written = vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string;
    expect(written).toContain("## Key Recent Facts");
    expect(written).toContain("new fact");
    expect(written).not.toContain("undefined");
  });

  it("updateHotCache handles an empty facts section without appending undefined", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("# Recent Context\n\n## Key Recent Facts");

    await ObsidianOrchestrator.updateHotCache("C:/repo", "new fact");

    const written = vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string;
    expect(written).toContain("new fact");
    expect(written).not.toContain("undefined");
  });

  it("getHotCache returns hot.md content", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("hot content");
    expect(ObsidianOrchestrator.getHotCache("C:/repo")).toBe("hot content");
  });

  it("wiki skill scaffolds vault structure", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const result = await ObsidianOrchestrator.wiki("C:/repo", "scaffold", "desc");
    expect(result).toContain("Wiki structure scaffolded");
    expect(fs.mkdirSync).toHaveBeenCalled();
  });

  it("ingest writes source to vault", async () => {
    const result = await ObsidianOrchestrator.ingest("C:/repo", "srcName", "content", "source");
    expect(result).toContain("Ingested to [[srcName]]");
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("save proxies to ingest", async () => {
    const result = await ObsidianOrchestrator.save("C:/repo", "title", "content");
    expect(result).toContain("Ingested to [[title]]");
  });

  it("query uses FlexSearch if available and finds results", async () => {
    ObsidianOrchestrator["searchIndex"] = { search: vi.fn().mockReturnValue(["id1", "id2"]) } as any;
    const result = await ObsidianOrchestrator.query("C:/repo", "question");
    expect(result).toContain("FlexSearch Enabled");
    ObsidianOrchestrator["searchIndex"] = null; // reset
  });

  it("query uses fallback search if FlexSearch is unavailable", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readdirSync").mockReturnValue(["match-question.md", "other.md"] as any);
    const result = await ObsidianOrchestrator.query("C:/repo", "question");
    expect(result).toContain("I found these related pages");
    expect(result).toContain("[[match-question]]");
  });

  it("query returns no direct matches if fallback search fails", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readdirSync").mockReturnValue(["nomatch.md", "other.md"] as any);
    const result = await ObsidianOrchestrator.query("C:/repo", "question");
    expect(result).toContain("No direct matches found in the wiki");
  });

  it("lint returns health check status", async () => {
    const result = await ObsidianOrchestrator.lint("C:/repo");
    expect(result).toContain("Wiki health check");
  });

  it("canvas merges or creates a canvas file with existing node", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue('{"nodes":[{"id":"n1"}]}');
    const result = await ObsidianOrchestrator.canvas("C:/repo", "map", { type: "text", id: "n1", text: "update" });
    expect(result).toContain("Canvas [[map]] saved");
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("update"));
  });

  it("canvas rejects names that would escape the configured vault", async () => {
    await expect(ObsidianOrchestrator.canvas("C:/repo", "../outside", { nodes: [] }))
      .rejects.toThrow("Target path escapes Obsidian vault");
  });

  it("canvas falls back to untitled when the sanitized name is empty", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const result = await ObsidianOrchestrator.canvas("C:/repo", "   ", { nodes: [] });
    expect(result).toBe("Canvas [[   ]] saved.");
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("untitled.canvas"), expect.any(String));
  });

  it("canvas adds new node to existing canvas", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue('{"nodes":[{"id":"n1"}]}');
    const result = await ObsidianOrchestrator.canvas("C:/repo", "map", { type: "text", id: "n2", text: "new" });
    expect(result).toContain("Canvas [[map]] saved");
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("n2"));
  });

  it("updateWikiMap calls canvas with a new node", async () => {
    vi.spyOn(ObsidianOrchestrator, "canvas").mockResolvedValue("Canvas saved");
    const result = await ObsidianOrchestrator.updateWikiMap("C:/repo", "Node Name", "Text");
    expect(result).toBe("Canvas saved");
  });

  it("autoresearch starts a research loop", async () => {
    const result = await ObsidianOrchestrator.autoresearch("C:/repo", "topic");
    expect(result).toContain("Research loop initiated");
  });

  it("defuddle strips clutter tags", async () => {
    const result = await ObsidianOrchestrator.defuddle("<html><style>a{}</style><nav>nav</nav><footer>foot</footer>content</html>");
    expect(result).toContain("content");
    expect(result).not.toContain("nav");
  });

  it("updateHotCache truncates if content exceeds 600 words", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    // Create a string with > 600 words and the required sections
    const longWords = Array(601).fill("word").join(" ");
    const longString = `# Recent Context\n## Key Recent Facts\n${longWords}`;
    vi.spyOn(fs, "readFileSync").mockReturnValue(longString);
    await ObsidianOrchestrator.updateHotCache("C:/repo", "change");
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("updateHotCache catches and logs write errors", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("content");
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("write error"); });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await ObsidianOrchestrator.updateHotCache("C:/repo", "change");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to update hot cache", expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it("getHotCache returns empty string if hot.md does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const result = ObsidianOrchestrator.getHotCache("C:/repo");
    expect(result).toBe("");
  });

  describe("lint", () => {
    it("returns error if Obsidian not configured", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      const res = await ObsidianOrchestrator.lint("C:/repo");
      expect(res).toBe("Obsidian not configured.");
    });
    
    it("returns health check string", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "readdirSync").mockReturnValue(["concept1.md", "concept2.md"] as any);
      const res = await ObsidianOrchestrator.lint("C:/repo");
      expect(res).toContain("Wiki health check at");
      expect(res).toContain("Found 2 concepts");
    });
  });

  describe("canvas", () => {
    it("returns early if Obsidian not configured", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      const res = await ObsidianOrchestrator.canvas("C:/repo", "test", {});
      expect(res).toBeUndefined();
    });

    it("writes new canvas if none exists", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      
      const res = await ObsidianOrchestrator.canvas("C:/repo", "test", { nodes: [] });
      expect(res).toBe("Canvas [[test]] saved.");
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("test.canvas"), JSON.stringify({ nodes: [] }, null, 2));
    });

    it("merges with existing canvas (new node without nodes array)", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}));
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

      const res = await ObsidianOrchestrator.canvas("C:/repo", "test", { id: "2", type: "text", text: "hello" });
      expect(res).toBe("Canvas [[test]] saved.");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("test.canvas"),
        expect.stringContaining('"id": "2"')
      );
    });

    it("merges with existing canvas (updating existing node)", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ nodes: [{ id: "2", type: "text", text: "old" }] }));
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

      await ObsidianOrchestrator.canvas("C:/repo", "test", { id: "2", type: "text", text: "new" });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("test.canvas"),
        expect.stringContaining('"text": "new"')
      );
    });

    it("falls back to overwrite if existing JSON is invalid", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue("{ invalid");
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

      await ObsidianOrchestrator.canvas("C:/repo", "test", { some: "data" });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("test.canvas"),
        expect.stringContaining('"some": "data"')
      );
    });
  });

  describe("query", () => {
    it("returns error if Obsidian not configured", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      const res = await ObsidianOrchestrator.query("C:/repo", "test");
      expect(res).toBe("Obsidian not configured.");
    });

    it("uses FlexSearch if searchIndex is populated", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      (ObsidianOrchestrator as any).searchIndex = { search: vi.fn().mockReturnValue([1, 2]) };
      const res = await ObsidianOrchestrator.query("C:/repo", "test");
      expect(res).toContain("Semantic Search found 2 related concepts");
      (ObsidianOrchestrator as any).searchIndex = null;
    });

    it("falls back to directory search if FlexSearch has no results", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      (ObsidianOrchestrator as any).searchIndex = { search: vi.fn().mockReturnValue([]) };
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readdirSync").mockReturnValue(["test.md"] as any);
      const res = await ObsidianOrchestrator.query("C:/repo", "test");
      expect(res).toContain("I found these related pages in your wiki: [[test]]");
      (ObsidianOrchestrator as any).searchIndex = null;
    });

    it("returns no direct matches if search yields nothing", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const res = await ObsidianOrchestrator.query("C:/repo", "test");
      expect(res).toBe("No direct matches found in the wiki.");
    });
  });

  describe("updateWikiMap", () => {
    it("returns early if Obsidian not configured", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      const res = await ObsidianOrchestrator.updateWikiMap("C:/repo", "node1", "text");
      expect(res).toBeUndefined();
    });

    it("calls canvas to update Wiki Map", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      const canvasSpy = vi.spyOn(ObsidianOrchestrator, "canvas").mockResolvedValue("Canvas [[Wiki Map]] saved.");
      await ObsidianOrchestrator.updateWikiMap("C:/repo", "Test Node", "some text");
      expect(canvasSpy).toHaveBeenCalledWith("C:/repo", "Wiki Map", expect.objectContaining({
        id: "node_test_node",
        type: "text",
        text: expect.stringContaining("some text")
      }));
    });
  });


  describe("getHotCache", () => {
    it("returns empty string if config is missing", () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      expect(ObsidianOrchestrator.getHotCache("C:/repo")).toBe("");
    });
  });

  describe("wiki", () => {
    it("wiki returns error if config is missing", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      const res = await ObsidianOrchestrator.wiki("C:/repo", "scaffold", "desc");
      expect(res).toBe("Obsidian not configured.");
    });

    it("wiki returns unimplemented for unknown actions", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      const result = await ObsidianOrchestrator.wiki("C:/repo", "unknown-action", "desc");
      expect(result).toBe("Action unknown-action not implemented in wiki skill.");
    });

    it("wiki scaffolds folder structure", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      vi.spyOn(ObsidianOrchestrator, "logActivity").mockResolvedValue();

      const res = await ObsidianOrchestrator.wiki("C:/repo", "scaffold", "desc");
      expect(res).toContain("Wiki structure scaffolded in C:/vault");
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("wiki scaffolds folder structure (skips existing)", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      vi.spyOn(ObsidianOrchestrator, "logActivity").mockResolvedValue();

      const res = await ObsidianOrchestrator.wiki("C:/repo", "scaffold", "desc");
      expect(res).toContain("Wiki structure scaffolded in C:/vault");
      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("ingest", () => {
    it("returns early if Obsidian not configured", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue(null);
      const res = await ObsidianOrchestrator.ingest("C:/repo", "source", "content");
      expect(res).toBeUndefined();
    });

    it("ingests source with correct frontmatter", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

      const res = await ObsidianOrchestrator.ingest("C:/repo", "My Source", "some content", "source");
      expect(res).toBe("Ingested to [[My Source]]");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("My_Source.md"),
        expect.stringContaining("some content")
      );
    });

    it("ingests concept with correct frontmatter", async () => {
      vi.spyOn(ConfigManager, "getObsidianConfig").mockReturnValue({ vaultPath: "C:/vault", syncLessons: true });
      vi.spyOn(fs, "existsSync").mockReturnValue(true); // folder exists
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

      const res = await ObsidianOrchestrator.ingest("C:/repo", "My Concept", "concept data", "concept");
      expect(res).toBe("Ingested to [[My Concept]]");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("My_Concept.md"),
        expect.stringContaining("concept data")
      );
    });
  });

  it("getGlobalPatterns catches and logs errors", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readdirSync").mockImplementation(() => { throw new Error("read error"); });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ObsidianOrchestrator.getGlobalPatterns("C:/repo");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to read global patterns from Obsidian", expect.any(Error));
    expect(result).toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  it("logActivity catches and logs write errors", async () => {
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("log error"); });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await ObsidianOrchestrator.logActivity("C:/repo", "summary", "rationale");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to log activity to Obsidian", expect.any(Error));
    consoleErrorSpy.mockRestore();
  });
});
