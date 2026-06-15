import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parseLastJsonLine, runProcess } from "../operations/child-process.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workerScript = join(repoRoot, "scripts", "stress", "event-store-soak-worker.mjs");

function readPositiveInteger(value, fallback, name) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  assert.ok(Number.isInteger(parsed) && parsed > 0, `${name} must be a positive integer.`);
  return parsed;
}

function readRatio(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  assert.ok(Number.isFinite(parsed) && parsed >= 0 && parsed <= 1, `${name} must be between 0 and 1.`);
  return parsed;
}

export async function runEventStoreSoak(options = {}) {
  const workers = readPositiveInteger(options.workers, 4, "workers");
  const durationMs = readPositiveInteger(options.durationMs, 10_000, "durationMs");
  const minOperations = readPositiveInteger(options.minOperations, workers * 10, "minOperations");
  const maxLossRatio = readRatio(options.maxLossRatio, 0, "maxLossRatio");
  const directory = await mkdtemp(join(tmpdir(), "prompt-refiner-soak-"));
  const databasePath = join(directory, "events.db");

  try {
    const results = await Promise.all(Array.from({ length: workers }, async (_, index) => {
      const result = await runProcess(process.execPath, [workerScript, String(index), String(durationMs)], {
        cwd: repoRoot,
        env: { ...process.env, PROMPT_REFINER_GLOBAL_DIR: directory, PROMPT_REFINER_LOG_LEVEL: "error" },
        timeoutMs: durationMs + 30_000,
      });
      return parseLastJsonLine(result.stdout);
    }));
    const expected = results.reduce((sum, result) => ({
      operations: sum.operations + result.operations,
      prompts: sum.prompts + result.prompts,
      executions: sum.executions + result.executions,
      events: sum.events + result.events + result.prompts,
    }), { operations: 0, prompts: 0, executions: 0, events: 0 });

    const database = new Database(databasePath, { readonly: true });
    try {
      const integrity = database.pragma("integrity_check", { simple: true });
      const actual = {
        prompts: database.prepare("SELECT COUNT(*) AS count FROM prompts").get().count,
        executions: database.prepare("SELECT COUNT(*) AS count FROM executions").get().count,
        events: database.prepare("SELECT COUNT(*) AS count FROM events").get().count,
      };
      const expectedRows = expected.prompts + expected.executions + expected.events;
      const actualRows = actual.prompts + actual.executions + actual.events;
      const lossRatio = expectedRows === 0 ? 1 : Math.max(0, expectedRows - actualRows) / expectedRows;

      assert.equal(integrity, "ok");
      assert.ok(expected.operations >= minOperations, `Soak completed ${expected.operations} operations; minimum is ${minOperations}.`);
      assert.ok(lossRatio <= maxLossRatio, `Soak loss ratio ${lossRatio} exceeded maximum ${maxLossRatio}.`);
      assert.ok(actual.prompts > 0 && actual.executions > 0 && actual.events > 0, "Soak did not exercise all mixed operation types.");

      return { workers, durationMs, integrity, expected, actual, lossRatio };
    } finally {
      database.close();
    }
  } finally {
    if (!options.keepDirectory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runEventStoreSoak({
    workers: process.env.PROMPT_REFINER_SOAK_WORKERS,
    durationMs: process.env.PROMPT_REFINER_SOAK_DURATION_MS,
    minOperations: process.env.PROMPT_REFINER_SOAK_MIN_OPERATIONS,
    maxLossRatio: process.env.PROMPT_REFINER_SOAK_MAX_LOSS_RATIO,
  });
  console.log(`EventStore soak passed: ${result.expected.operations} mixed operations, integrity=${result.integrity}, loss=${result.lossRatio}.`);
}
