import * as fs from "fs";
import * as path from "path";
// @ts-ignore
import flexsearch from "flexsearch";
const { Index } = flexsearch;
export class NeuralSnippets {
    static index = new Index({
        tokenize: "forward",
        resolution: 9
    });
    static store = new Map();
    static isInitialized = false;
    static async walkDir(dir, fileList = []) {
        if (!fs.existsSync(dir))
            return fileList;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const name = path.join(dir, file);
            if (fs.statSync(name).isDirectory()) {
                if (file !== "node_modules" && file !== "dist" && !file.startsWith(".")) {
                    await this.walkDir(name, fileList);
                }
            }
            else {
                if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".py")) {
                    fileList.push(name);
                }
            }
        }
        return fileList;
    }
    static async initialize() {
        if (this.isInitialized)
            return;
        const files = await this.walkDir(".");
        let id = 0;
        for (const filePath of files) {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i += 10) {
                const chunk = lines.slice(i, i + 25).join("\n");
                if (chunk.trim().length > 20) {
                    this.index.add(id, chunk);
                    this.store.set(id, { id, filePath, content: chunk });
                    id++;
                }
            }
        }
        console.error(`[NeuralSnippets] Indexed ${files.length} files into ${id} entries.`);
        this.isInitialized = true;
    }
    static async search(query, limit = 5) {
        await this.initialize();
        // Break query into keywords for better matching
        const keywords = query.split(/\s+/).map(w => w.replace(/[^\w\s]/g, "")).filter(w => w.length > 2);
        const snippets = [];
        const seenIds = new Set();
        // Try combined search first
        const mainResults = await this.index.search(query, limit);
        if (mainResults) {
            for (const id of mainResults) {
                const doc = this.store.get(id);
                if (doc) {
                    snippets.push(doc);
                    seenIds.add(id);
                }
            }
        }
        // Fallback to individual keywords
        if (snippets.length < limit) {
            for (const word of keywords) {
                const wordResults = await this.index.search(word, 1);
                if (wordResults) {
                    for (const id of wordResults) {
                        if (!seenIds.has(id)) {
                            const doc = this.store.get(id);
                            if (doc) {
                                snippets.push(doc);
                                seenIds.add(id);
                            }
                        }
                    }
                }
                if (snippets.length >= limit)
                    break;
            }
        }
        console.error(`[NeuralSnippets] Search for "${query}" found ${snippets.length} snippets.`);
        return snippets;
    }
}
