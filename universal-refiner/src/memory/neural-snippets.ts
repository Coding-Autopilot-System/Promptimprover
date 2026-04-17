import * as fs from "fs";
import * as path from "path";
// @ts-ignore
import flexsearch from "flexsearch";
import ts from "typescript";

const { Index } = flexsearch;

export interface Snippet {
  id: number;
  filePath: string;
  content: string;
  symbolName?: string;
  symbolType?: "class" | "function" | "interface" | "type" | "const" | "chunk";
}

export class NeuralSnippets {
  private static symbolIndex = new Index({ tokenize: "forward", resolution: 9 });
  private static contentIndex = new Index({ tokenize: "forward", resolution: 5 });
  private static store = new Map<number, Snippet>();
  public static isInitialized = false;

  static reset() {
    this.symbolIndex = new Index({ tokenize: "forward", resolution: 9 });
    this.contentIndex = new Index({ tokenize: "forward", resolution: 5 });
    this.store.clear();
    this.isInitialized = false;
  }

  private static async walkDir(dir: string, fileList: string[] = []): Promise<string[]> {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const name = path.join(dir, file);
      if (fs.statSync(name).isDirectory()) {
        const ignoreDirs = ["node_modules", "dist", "build", "out", "coverage", "tests", "test"];
        if (!ignoreDirs.includes(file) && !file.startsWith(".")) {
          await this.walkDir(name, fileList);
        }
      } else {
        if ((file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".py")) && !file.includes(".test.") && !file.includes(".spec.")) {
          fileList.push(name);
        }
      }
    }
    return fileList;
  }

  private static extractSymbolBlock(lines: string[], startIndex: number, type: string): string {
    const startLine = lines[startIndex];
    const result: string[] = [startLine];
    
    if (type === "py") {
      const startIndent = startLine.match(/^\s*/)?.[0].length || 0;
      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") {
          result.push(line);
          continue;
        }
        const currentIndent = line.match(/^\s*/)?.[0].length || 0;
        if (currentIndent <= startIndent && line.trim() !== "") break;
        result.push(line);
      }
    } 
    else {
      let openBrackets = (startLine.match(/{/g) || []).length - (startLine.match(/}/g) || []).length;
      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        result.push(line);
        openBrackets += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        if (openBrackets <= 0 && (line.includes("}") || result.length > 5)) break;
        if (result.length > 50) break;
      }
    }
    return result.join("\n");
  }

  private static parseSymbols(content: string, filePath: string): Partial<Snippet>[] {
    const symbols: Partial<Snippet>[] = [];
    const isPython = filePath.endsWith(".py");

    if (isPython) {
      const lines = content.split("\n");
      const pyRegex = /^\s*(class|def)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
      let match;
      while ((match = pyRegex.exec(content)) !== null) {
        const lineIndex = content.substring(0, match.index).split("\n").length - 1;
        symbols.push({
          symbolName: match[2],
          symbolType: match[1] === "class" ? "class" : "function",
          content: this.extractSymbolBlock(lines, lineIndex, "py")
        });
      }
    } else {
      // Robust TypeScript/JavaScript parsing via AST
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
      
      const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node) && node.name) {
          symbols.push({ symbolName: node.name.text, symbolType: "class", content: node.getText(sourceFile) });
        } else if (ts.isFunctionDeclaration(node) && node.name) {
          symbols.push({ symbolName: node.name.text, symbolType: "function", content: node.getText(sourceFile) });
        } else if (ts.isInterfaceDeclaration(node) && node.name) {
          symbols.push({ symbolName: node.name.text, symbolType: "interface", content: node.getText(sourceFile) });
        } else if (ts.isTypeAliasDeclaration(node) && node.name) {
          symbols.push({ symbolName: node.name.text, symbolType: "type", content: node.getText(sourceFile) });
        }
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFile);
    }
    return symbols;
  }

  static async initialize(rootPath: string = ".") {
    if (this.isInitialized) return;
    const files = await this.walkDir(rootPath);
    let id = 0;
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf-8");
      const symbols = this.parseSymbols(content, filePath);
      for (const sym of symbols) {
        const doc: Snippet = { id: id++, filePath, content: sym.content!, symbolName: sym.symbolName, symbolType: sym.symbolType as any };
        this.symbolIndex.add(doc.id, doc.symbolName || "");
        this.contentIndex.add(doc.id, doc.content);
        this.store.set(doc.id, doc);
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 15) {
        const chunk = lines.slice(i, i + 25).join("\n");
        if (chunk.trim().length > 100) {
          const doc: Snippet = { id: id++, filePath, content: chunk, symbolType: "chunk" };
          this.contentIndex.add(doc.id, doc.content);
          this.store.set(doc.id, doc);
        }
      }
    }
    this.isInitialized = true;
  }

  static async search(query: string, rootPath: string = ".", limit = 5): Promise<Snippet[]> {
    await this.initialize(rootPath);
    const symbolSnippets: Snippet[] = [];
    const chunkSnippets: Snippet[] = [];
    const seenIds = new Set<number>();
    const keywords = query.split(/\s+/).map(w => w.replace(/[^\w\s]/g, "")).filter(w => w.length > 2);

    const searchTerms = [query, ...keywords];

    // 1. Search for High-Signal Symbols First (Classes, Functions, Interfaces)
    for (const word of searchTerms) {
      const symRes = await this.symbolIndex.search(word, limit);
      if (symRes) {
        for (const id of symRes as number[]) {
          const doc = this.store.get(id);
          if (doc && !seenIds.has(id)) { 
            symbolSnippets.push(doc); 
            seenIds.add(id); 
          }
        }
      }
      if (symbolSnippets.length >= limit) break;
    }

    // 2. Fallback to Content Chunks if more context is needed
    for (const word of searchTerms) {
      if (symbolSnippets.length + chunkSnippets.length >= limit) break;
      const contRes = await this.contentIndex.search(word, limit);
      if (contRes) {
        for (const id of contRes as number[]) {
          const doc = this.store.get(id);
          if (doc && !seenIds.has(id) && doc.symbolType === "chunk") { 
            chunkSnippets.push(doc); 
            seenIds.add(id); 
          }
        }
      }
    }

    // Prioritize specific symbols over generic chunks
    return [...symbolSnippets, ...chunkSnippets].slice(0, limit);
  }
}
