import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = resolve(import.meta.dirname, "..");
const script = join(repoRoot, "register-global.ps1");
const roots: string[] = [];

function makeRoot(): string {
  const root = join(tmpdir(), `promptimprover-register-${process.pid}-${Date.now()}-${roots.length}`, "KimHarjamäki");
  mkdirSync(root, { recursive: true });
  roots.push(resolve(root, ".."));
  return root;
}

function run(root: string, mode: "-Check" | "-Apply") {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    mode,
    "-ProfileRoot", root,
    "-ObsidianVaultPath", join(root, "Obsidian Vault"),
  ], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("global registration doctor", () => {
  it("applies idempotent Unicode-safe merges while preserving unrelated config", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".claude"), { recursive: true });
    mkdirSync(join(root, ".gemini"), { recursive: true });
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".claude.json"), JSON.stringify({ unrelated: { enabled: true } }), "utf8");
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Read"] } }), "utf8");
    writeFileSync(join(root, ".gemini", "settings.json"), JSON.stringify({
      theme: "dark",
      hooks: {
        BeforeAgent: [
          { hooks: [{ name: "unrelated", type: "command", command: "keep-hook" }] },
          { hooks: [{ name: "stale", type: "command", command: "promptimprover-hook-pre", timeout: 1 }] },
        ],
      },
    }), "utf8");
    writeFileSync(join(root, ".codex", "config.toml"), 'model = "test"\n\n[mcp_servers.keep]\ncommand = "keep"\n', "utf8");

    const first = run(root, "-Apply");
    expect(first.status, first.stderr || first.stdout).toBe(0);

    const claude = JSON.parse(readFileSync(join(root, ".claude.json"), "utf8"));
    const gemini = JSON.parse(readFileSync(join(root, ".gemini", "settings.json"), "utf8"));
    const codex = readFileSync(join(root, ".codex", "config.toml"), "utf8");
    expect(claude.unrelated.enabled).toBe(true);
    expect(claude.mcpServers["prompt-refiner"].args[0]).toContain("/universal-refiner/dist/src/index.js");
    expect(claude.mcpServers.obsidian.args.at(-1)).toContain("KimHarjamäki/Obsidian Vault");
    expect(gemini.theme).toBe("dark");
    expect(gemini.hooks.BeforeAgent).toHaveLength(2);
    expect(gemini.hooks.BeforeAgent).toContainEqual({ hooks: [{ name: "unrelated", type: "command", command: "keep-hook" }] });
    expect(gemini.hooks.BeforeAgent).toContainEqual({
      hooks: [{ name: "promptimprover-pre-prompt", type: "command", command: "promptimprover-hook-pre", timeout: 20 }],
    });
    expect(codex).toContain('[mcp_servers.keep]');
    expect(codex).toContain('[mcp_servers.prompt-refiner]');
    expect(codex).toContain('[mcp_servers.obsidian]');
    expect(readFileSync(join(root, ".claude.json")).subarray(0, 3).toString("hex")).not.toBe("efbbbf");

    const backupCount = readdirSync(root, { recursive: true }).filter((name) => name.includes("promptimprover-backup")).length;
    expect(backupCount).toBeGreaterThan(0);
    const check = run(root, "-Check");
    expect(check.status, check.stderr || check.stdout).toBe(0);
    const second = run(root, "-Apply");
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(readdirSync(root, { recursive: true }).filter((name) => name.includes("promptimprover-backup"))).toHaveLength(backupCount);
  }, 30_000);

  it("reports drift, mojibake, and credential field paths without printing values", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".gemini"), { recursive: true });
    writeFileSync(join(root, ".gemini", "settings.json"), JSON.stringify({
      title: "broken Ã¤",
      apiKey: "do-not-print-this",
    }), "utf8");

    const result = run(root, "-Check");
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout + result.stderr).toContain("mojibake detected");
    expect(result.stdout + result.stderr).toContain("$.apiKey");
    expect(result.stdout + result.stderr).not.toContain("do-not-print-this");
    expect(existsSync(join(root, ".claude.json"))).toBe(false);
  });

  it("refuses to merge invalid JSON without overwriting it", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".claude"), { recursive: true });
    const configPath = join(root, ".claude", "settings.json");
    writeFileSync(configPath, "{", "utf8");

    const result = run(root, "-Apply");
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout + result.stderr).toContain("Cannot safely merge invalid JSON config");
    expect(readFileSync(configPath, "utf8")).toBe("{");
    expect(existsSync(join(root, ".codex", "config.toml"))).toBe(false);
  });
});
