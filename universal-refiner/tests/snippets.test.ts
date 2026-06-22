// secret-scan: allow-fixture
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { NeuralSnippets } from "../src/memory/neural-snippets.js";

describe("NeuralSnippets", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snippets-test-"));
    NeuralSnippets.reset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should parse TypeScript symbols correctly", async () => {
    const tsCode = `
      export class UserRepo {
        async save(user: User) {
          return db.save(user);
        }
      }
      export function validate(input: string) {
        return input.length > 0;
      }
    `;
    fs.writeFileSync(path.join(tmpDir, "repo.ts"), tsCode);

    await NeuralSnippets.initialize(tmpDir);
    const snippets = await NeuralSnippets.search("UserRepo", tmpDir);
    
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.some(s => s.symbolName === "UserRepo")).toBe(true);
  });

  it("should parse Python symbols correctly", async () => {
    const pyCode = `
class Service:
    def execute(self):
        print("Executing")

def helper():
    return True
    `;
    fs.writeFileSync(path.join(tmpDir, "service.py"), pyCode);

    await NeuralSnippets.initialize(tmpDir);
    const snippets = await NeuralSnippets.search("Service", tmpDir);

    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.some(s => s.symbolName === "Service")).toBe(true);
  });

  it("does not traverse symlinks or index sensitive filenames and content", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "snippets-outside-"));
    fs.writeFileSync(path.join(outside, "escaped.ts"), "export function escapedSecret() {}");
    fs.symlinkSync(outside, path.join(tmpDir, "linked-outside"), "junction");
    fs.writeFileSync(path.join(tmpDir, "credentials.ts"), "export function filenameSecret() {}");
    fs.writeFileSync(path.join(tmpDir, "literal.ts"), 'const apiKey = "literal-secret"; export function contentSecret() {}');
    fs.writeFileSync(path.join(tmpDir, "safe.ts"), "interface Login { password: string }\nexport function safeSource() {}");

    try {
      await NeuralSnippets.initialize(tmpDir);

      expect(await NeuralSnippets.search("escapedSecret", tmpDir)).toEqual([]);
      expect(await NeuralSnippets.search("filenameSecret", tmpDir)).toEqual([]);
      expect(await NeuralSnippets.search("contentSecret", tmpDir)).toEqual([]);
      expect(await NeuralSnippets.search("safeSource", tmpDir)).toMatchObject([{ symbolName: "safeSource" }]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects missing, outside, and swapped traversal results during canonical checks", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "snippets-canonical-outside-"));
    const outsideFile = path.join(outside, "outside.ts");
    const linkedOutside = path.join(tmpDir, "linked-outside");
    const insideFile = path.join(tmpDir, "inside.ts");
    fs.writeFileSync(outsideFile, "export function outsideSource() {}");
    fs.writeFileSync(insideFile, "export function insideSource() {}");
    fs.symlinkSync(outside, linkedOutside, "junction");

    const walkDir = (NeuralSnippets as any).walkDir.bind(NeuralSnippets);
    expect(await walkDir(path.join(tmpDir, "missing"), tmpDir)).toEqual([]);
    expect(await walkDir(tmpDir, outside)).toEqual([]);

    const originalWalkDir = (NeuralSnippets as any).walkDir;
    (NeuralSnippets as any).walkDir = async () => [linkedOutside, outsideFile];
    try {
      await NeuralSnippets.initialize(tmpDir);
      expect(await NeuralSnippets.search("outsideSource", tmpDir)).toEqual([]);
    } finally {
      (NeuralSnippets as any).walkDir = originalWalkDir;
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
