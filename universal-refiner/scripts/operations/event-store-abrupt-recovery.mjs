import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workerScript = join(repoRoot, "scripts", "operations", "event-store-crash-worker.mjs");

export async function runAbruptRecovery(options = {}) {
  const writes = options.writes ?? 25;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const directory = await mkdtemp(join(tmpdir(), "prompt-refiner-abrupt-recovery-"));
  const databasePath = join(directory, "events.db");
  const previousGlobalDir = process.env.PROMPT_REFINER_GLOBAL_DIR;
  let child;

  try {
    const ready = new Promise((resolveReady, reject) => {
      child = spawn(process.execPath, [workerScript, String(writes)], {
        cwd: repoRoot,
        env: { ...process.env, PROMPT_REFINER_GLOBAL_DIR: directory, PROMPT_REFINER_LOG_LEVEL: "error" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => reject(new Error(`Crash worker did not become ready within ${timeoutMs}ms.\n${stderr}`)), timeoutMs);
      timer.unref();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        stdout += chunk;
        const line = stdout.split(/\r?\n/u).find(candidate => candidate.trim());
        if (!line) return;
        clearTimeout(timer);
        resolveReady(JSON.parse(line));
      });
      child.stderr.on("data", chunk => stderr += chunk);
      child.on("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", code => {
        if (!stdout.trim()) {
          clearTimeout(timer);
          reject(new Error(`Crash worker exited ${code} before readiness.\n${stderr}`));
        }
      });
    });

    assert.deepEqual(await ready, { ready: true, writes });
    const closed = new Promise(resolveClosed => child.once("close", resolveClosed));
    assert.equal(child.kill("SIGKILL"), true, "Failed to terminate crash worker.");
    await closed;

    process.env.PROMPT_REFINER_GLOBAL_DIR = directory;
    const { EventStore } = await import("../../dist/src/history/event-store.js");
    const store = EventStore.getInstance();
    try {
      store.recordEvent({
        id: "after-abrupt-restart",
        event_type: "abrupt_recovery",
        summary: "EventStore reopened after abrupt termination",
      });
    } finally {
      store.close();
    }

    const database = new Database(databasePath, { readonly: true });
    try {
      const integrity = database.pragma("integrity_check", { simple: true });
      const count = database.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'abrupt_recovery'").get().count;
      assert.equal(integrity, "ok");
      assert.equal(count, writes + 1);
      return { databasePath, integrity, recoveredWrites: count };
    } finally {
      database.close();
    }
  } finally {
    if (previousGlobalDir === undefined) {
      delete process.env.PROMPT_REFINER_GLOBAL_DIR;
    } else {
      process.env.PROMPT_REFINER_GLOBAL_DIR = previousGlobalDir;
    }
    if (child?.exitCode === null) {
      child.kill("SIGKILL");
    }
    if (!options.keepDirectory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const writes = Number.parseInt(process.env.PROMPT_REFINER_RECOVERY_WRITES || "25", 10);
  const result = await runAbruptRecovery({ writes });
  console.log(`Abrupt EventStore recovery passed: integrity=${result.integrity}, recovered=${result.recoveredWrites}.`);
}
