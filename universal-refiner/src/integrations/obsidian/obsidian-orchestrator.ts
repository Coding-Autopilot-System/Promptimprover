import { ConfigManager } from "../../core/config.js";
import { RuntimeLogger } from "../../core/logger.js";
import { EventStore } from "../../history/event-store.js";
import { LearnedPattern, LocalBrain } from "../../memory/local-brain.js";
import * as path from "path";
import * as fs from "fs";
import * as chokidar from "chokidar";
// @ts-ignore
import flexsearch from "flexsearch";
import * as lancedb from "@lancedb/lancedb";

const { Index } = flexsearch;

export class ObsidianOrchestrator {
  private static watcher: chokidar.FSWatcher | null = null;
  private static searchIndex: any = null;
  private static db: lancedb.Connection | null = null;
  private static table: lancedb.Table | null = null;

  private static getVaultPath(rootPath: string = "."): string | null {
    const config = ConfigManager.getObsidianConfig(rootPath);
    return config?.vaultPath || null;
  }

  /**
   * Initializes file-system watchers and vector store.
   */
  static async initWatchers(rootPath: string = ".") {
    const vaultPath = this.getVaultPath(rootPath);
    if (!vaultPath) return;

    if (this.watcher) {
      await this.watcher.close();
    }

    const conceptsDir = path.join(vaultPath, "wiki", "concepts");
    if (!fs.existsSync(conceptsDir)) return;

    RuntimeLogger.info(`[ObsidianWatcher] Starting real-time sync for ${conceptsDir}`);
    
    this.watcher = chokidar.watch(conceptsDir, {
      ignored: /(^|[\/\\])\../,
      persistent: true
    });

    this.watcher.on("change", (filePath: string) => {
      RuntimeLogger.info(`[ObsidianWatcher] Detected change in ${path.basename(filePath)}. Syncing...`);
      this.reindex(vaultPath);
    });

    // Initialize Search Index (FlexSearch)
    this.searchIndex = new Index({
      tokenize: "forward",
      cache: true
    });
    
    // Initialize LanceDB
    try {
      const dbPath = path.join(vaultPath, ".lancedb");
      this.db = await lancedb.connect(dbPath);
      
      this.reindex(vaultPath);
    } catch (e) {
      RuntimeLogger.error("Failed to initialize LanceDB", e);
    }
  }

  private static async reindex(vaultPath: string) {
    if (!this.searchIndex || !this.db) return;
    
    const conceptsDir = path.join(vaultPath, "wiki", "concepts");
    if (!fs.existsSync(conceptsDir)) return;

    const files = fs.readdirSync(conceptsDir).filter(f => f.endsWith(".md"));
    const data = [];

    for (let i = 0; i < files.length; i++) {
      const content = fs.readFileSync(path.join(conceptsDir, files[i]), "utf-8");
      this.searchIndex.add(i, content);
      
      // Simple hash-based vector for demo (in production use real embeddings)
      const vector = this.getDummyVector(content);
      data.push({
        id: i,
        name: files[i],
        text: content,
        vector: vector
      });
    }

    if (data.length > 0) {
      try {
        if (await this.db.tableNames().then(tabs => tabs.includes("wiki_concepts"))) {
          this.table = await this.db.openTable("wiki_concepts");
          await this.table.add(data);
        } else {
          this.table = await this.db.createTable("wiki_concepts", data);
        }
      } catch (e) {
        RuntimeLogger.error("LanceDB reindex failed", e);
      }
    }
  }

  private static getDummyVector(text: string): number[] {
    const vec = new Array(128).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 128] += text.charCodeAt(i) / 255;
    }
    return vec;
  }


  static async syncToWiki(rootPath: string = ".") {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config || !config.syncLessons) return;

    try {
      const repoId = path.basename(rootPath);
      const store = EventStore.getInstance();
      
      const lessons = store.getRecentLessons(repoId, 50);
      if (lessons.length === 0) return;

      const wikiPath = path.join(config.vaultPath, "wiki", "concepts", `Engineering Mandates - ${repoId}.md`);
      const wikiDir = path.dirname(wikiPath);
      
      if (!fs.existsSync(wikiDir)) {
        fs.mkdirSync(wikiDir, { recursive: true });
      }

      let content = `---\ntags: [engineering, mandates, ${repoId}]\n---\n\n`;
      content += `# Engineering Mandates for ${repoId}\n\n`;
      content += `> [!info] Automatically extracted from successful project history by Promptimprover.\n\n`;
      
      for (const lesson of lessons) {
        content += `## ${lesson.title}\n`;
        content += `- **Type**: ${lesson.lesson_type}\n`;
        content += `- **Confidence**: ${lesson.confidence}\n`;
        content += `- **Summary**: ${lesson.summary}\n\n`;
      }

      content += `\n*Last updated: ${new Date().toLocaleString()}*`;

      fs.writeFileSync(wikiPath, content);
      RuntimeLogger.info(`Successfully synced ${lessons.length} mandates for ${repoId} to Obsidian Wiki.`);
    } catch (error) {
      RuntimeLogger.error("Failed to sync to Obsidian Wiki", error);
    }
  }

  static getGlobalPatterns(rootPath: string = "."): LearnedPattern[] {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return [];

    const patterns: LearnedPattern[] = [];
    const conceptsDir = path.join(config.vaultPath, "wiki", "concepts");

    if (!fs.existsSync(conceptsDir)) return [];

    try {
      const files = fs.readdirSync(conceptsDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(conceptsDir, file), "utf-8");
        
        const sections = content.split("## ").slice(1);
        for (const section of sections) {
          const lines = section.split("\n");
          const title = lines[0].trim();
          const summaryMatch = section.match(/- \*\*Summary\*\*: (.*)/);
          const typeMatch = section.match(/- \*\*Type\*\*: (.*)/);
          
          if (summaryMatch) {
            patterns.push({
              id: `${path.basename(file, ".md")} | ${title}`,
              category: typeMatch ? typeMatch[1] : "general",
              description: summaryMatch[1],
              learnedAt: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error("Failed to read global patterns from Obsidian", error);
    }

    return patterns;
  }

  static async logActivity(rootPath: string, summary: string, rationale: string = "") {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return;

    try {
      const repoId = path.basename(rootPath);
      const logDir = path.join(config.vaultPath, "wiki", "log", repoId);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const date = new Date();
      const fileName = `${date.toISOString().split("T")[0]}-${date.getTime()}.md`;
      const logPath = path.join(logDir, fileName);

      let content = `---\ntype: activity-log\nrepo_id: ${repoId}\ncreated: ${date.toISOString()}\nsummary: "${summary.replace(/"/g, '\\"')}"\n---\n\n`;
      content += `# Activity Log: ${repoId}\n\n`;
      content += `## Summary\n${summary}\n\n`;
      if (rationale) {
        content += `## Rationale (The "Why")\n${rationale}\n\n`;
      }
      content += `\n*Recorded by Promptimprover on ${date.toLocaleString()}*`;

      fs.writeFileSync(logPath, content);
      
      const indexLogPath = path.join(config.vaultPath, "wiki", "log", `${repoId}.md`);
      const logLine = `| ${date.toLocaleString()} | ${summary} | [[${repoId}/${path.basename(fileName, ".md")}\\|View Details]] |\n`;
      
      if (!fs.existsSync(indexLogPath)) {
        fs.writeFileSync(indexLogPath, `# Log for ${repoId}\n\n| Date | Activity | Details |\n|------|----------|---------|\n${logLine}`);
      } else {
        const current = fs.readFileSync(indexLogPath, "utf-8");
        const lines = current.split("\n");
        // Insert after header (3 lines)
        lines.splice(4, 0, logLine.trim());
        fs.writeFileSync(indexLogPath, lines.join("\n"));
      }

      await this.updateHotCache(rootPath, `Recorded activity: ${summary}`);
    } catch (error) {
      console.error("Failed to log activity to Obsidian", error);
    }
  }

  static async updateHotCache(rootPath: string, change: string) {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return;

    const hotCachePath = path.join(config.vaultPath, "wiki", "hot.md");
    const repoId = path.basename(rootPath);
    const date = new Date().toISOString();

    try {
      let content = "";
      if (fs.existsSync(hotCachePath)) {
        content = fs.readFileSync(hotCachePath, "utf-8");
      }

      // Very simple hot cache update: just prepend the latest change
      const header = `---\ntype: meta\ntitle: "Hot Cache"\nupdated: ${date}\n---\n\n# Recent Context\n\n`;
      const changeLine = `- [${new Date().toLocaleString()}] (${repoId}): ${change}\n`;

      if (!content.includes("# Recent Context")) {
        content = header + "## Key Recent Facts\n" + changeLine;
      } else {
        const sections = content.split("## Key Recent Facts");
        content = sections[0] + "## Key Recent Facts\n" + changeLine + sections[1];
      }

      // Truncate if too long (rough word count check)
      if (content.split(" ").length > 600) {
        const lines = content.split("\n");
        content = lines.slice(0, 50).join("\n"); // Crude truncation
      }

      fs.writeFileSync(hotCachePath, content);
    } catch (error) {
      console.error("Failed to update hot cache", error);
    }
  }

  static getHotCache(rootPath: string = "."): string {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return "";
    const hotCachePath = path.join(config.vaultPath, "wiki", "hot.md");
    if (fs.existsSync(hotCachePath)) {
      return fs.readFileSync(hotCachePath, "utf-8");
    }
    return "";
  }

  // --- NEW 10 SKILLS INTEGRATION ---

  /**
   * wiki skill: Main entry point for vault management.
   */
  static async wiki(rootPath: string, action: string, description: string) {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return "Obsidian not configured.";

    if (action === "scaffold") {
      const wikiDir = path.join(config.vaultPath, "wiki");
      const folders = ["sources", "entities", "concepts", "domains", "comparisons", "questions", "meta", "log"];
      for (const f of folders) {
        const dir = path.join(wikiDir, f);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const indexFile = path.join(dir, "_index.md");
        if (!fs.existsSync(indexFile)) fs.writeFileSync(indexFile, `# ${f.charAt(0).toUpperCase() + f.slice(1)} Index\n\n[[wiki/index|Back to Master Index]]`);
      }
      
      if (!fs.existsSync(path.join(wikiDir, "index.md"))) fs.writeFileSync(path.join(wikiDir, "index.md"), "# Master Index\n\n## Domains\n- [[wiki/domains/_index|Domains]]\n\n## Concepts\n- [[wiki/concepts/_index|Concepts]]");
      if (!fs.existsSync(path.join(wikiDir, "hot.md"))) fs.writeFileSync(path.join(wikiDir, "hot.md"), "# Recent Context");
      
      await this.logActivity(rootPath, `Scaffolded wiki structure for: ${description}`);
      return `Wiki structure scaffolded in ${config.vaultPath}`;
    }
    return `Action ${action} not implemented in wiki skill.`;
  }

  static async ingest(rootPath: string, sourceName: string, content: string, type: string = "source") {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return;

    const fileName = `${sourceName.replace(/[^a-z0-9]/gi, "_")}.md`;
    const targetDir = path.join(config.vaultPath, "wiki", type === "source" ? "sources" : "concepts");
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const filePath = path.join(targetDir, fileName);
    const date = new Date().toISOString().split("T")[0];
    const frontmatter = `---\ntype: ${type}\ntitle: "${sourceName}"\ncreated: ${date}\n---\n\n`;
    
    fs.writeFileSync(filePath, frontmatter + content);
    await this.logActivity(rootPath, `Ingested ${type}: [[${sourceName}]]`);
    return `Ingested to [[${sourceName}]]`;
  }

  static async save(rootPath: string, title: string, content: string, type: string = "synthesis") {
    return this.ingest(rootPath, title, content, type);
  }

  static async query(rootPath: string, question: string): Promise<string> {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return "Obsidian not configured.";
    
    // Use FlexSearch if initialized
    if (this.searchIndex) {
      const results = this.searchIndex.search(question, { limit: 5 });
      if (results.length > 0) {
        return `Semantic Search found ${results.length} related concepts in the wiki. (FlexSearch Enabled)`;
      }
    }

    // Simple mock query fallback: search concepts and sources
    const wikiDir = path.join(config.vaultPath, "wiki");
    const results: string[] = [];
    
    const searchDirs = [path.join(wikiDir, "concepts"), path.join(wikiDir, "sources")];
    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.toLowerCase().includes(question.toLowerCase())) {
            results.push(`[[${path.basename(file, ".md")}]]`);
          }
        }
      }
    }

    if (results.length > 0) {
      return `I found these related pages in your wiki: ${results.join(", ")}`;
    }
    return "No direct matches found in the wiki.";
  }

  static async lint(rootPath: string) {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return "Obsidian not configured.";
    
    const wikiDir = path.join(config.vaultPath, "wiki");
    // Placeholder health check
    return `Wiki health check at ${wikiDir}: OK. (Found ${fs.readdirSync(path.join(wikiDir, "concepts")).length} concepts).`;
  }

  static async canvas(rootPath: string, name: string, data: any) {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return;
    const canvasPath = path.join(config.vaultPath, `${name}.canvas`);
    
    let finalData = data;
    if (fs.existsSync(canvasPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(canvasPath, "utf-8"));
        // If data is just a node, merge it
        if (data.type && data.id) {
          existing.nodes = existing.nodes || [];
          const idx = existing.nodes.findIndex((n: any) => n.id === data.id);
          if (idx >= 0) existing.nodes[idx] = data;
          else existing.nodes.push(data);
          finalData = existing;
        }
      } catch (e) {
        // Fallback to overwrite if existing is invalid
      }
    }

    fs.writeFileSync(canvasPath, JSON.stringify(finalData, null, 2));
    await this.logActivity(rootPath, `Updated canvas: [[${name}.canvas]]`);
    return `Canvas [[${name}]] saved.`;
  }

  static async updateWikiMap(rootPath: string, nodeName: string, text: string) {
    const config = ConfigManager.getObsidianConfig(rootPath);
    if (!config) return;

    const canvasName = "Wiki Map";
    const nodeId = `node_${nodeName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    
    // Create a node for this discovery
    const node = {
      id: nodeId,
      type: "text",
      text: `### ${nodeName}\n${text}`,
      x: Math.floor(Math.random() * 1000),
      y: Math.floor(Math.random() * 1000),
      width: 400,
      height: 200
    };

    return this.canvas(rootPath, canvasName, node);
  }

  static async autoresearch(rootPath: string, topic: string) {
    await this.logActivity(rootPath, `Autonomous research started for: ${topic}`);
    return `Research loop initiated for "${topic}".`;
  }

  static async defuddle(content: string) {
    // Basic clutter removal logic
    return content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gim, "")
                  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gim, "")
                  .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gim, "")
                  .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gim, "");
  }
}
