import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const workers = Number.parseInt(process.env.PROMPT_REFINER_STRESS_WORKERS || "4", 10);
const writes = Number.parseInt(process.env.PROMPT_REFINER_STRESS_WRITES || "100", 10);
const directory = await mkdtemp(join(tmpdir(), "prompt-refiner-stress-"));
const workerScript = fileURLToPath(new URL("./event-store-worker.mjs", import.meta.url));

function runWorker(workerId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerScript, String(workerId), String(writes)], {
      env: { ...process.env, PROMPT_REFINER_GLOBAL_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`worker ${workerId} exited ${code}: ${stderr}`)));
  });
}

try {
  await Promise.all(Array.from({ length: workers }, (_, index) => runWorker(index)));
  const database = new Database(join(directory, "events.db"), { readonly: true });
  const row = database.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'stress'").get();
  database.close();
  assert.equal(row.count, workers * writes);
  console.log(`EventStore stress passed: ${workers} workers wrote ${row.count} events.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
