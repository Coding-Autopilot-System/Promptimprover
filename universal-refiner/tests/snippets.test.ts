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
});
