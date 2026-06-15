import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parseLastJsonLine, runProcess } from "../operations/child-process.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function runTrackedTurnAcceptance(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "prompt-refiner-real-turn-"));
  const profile = join(directory, "profile");
  const project = join(directory, "project");
  const sessionId = options.sessionId ?? "acceptance-session";
  const timeoutMs = options.timeoutMs ?? 45_000;
  const preHook = join(repoRoot, "dist", "hooks", "pre-prompt.js");
  const postHook = join(repoRoot, "dist", "hooks", "post-execution.js");
  const databasePath = join(profile, ".refiner", "events.db");

  try {
    await mkdir(profile, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "tracked-turn-fixture", private: true }));

    const env = {
      ...process.env,
      USERPROFILE: profile,
      HOME: profile,
      AZURE_CONFIG_DIR: join(profile, ".azure"),
      PROMPT_REFINER_LOG_LEVEL: "error",
    };
    const commonInput = {
      client: "acceptance",
      session_id: sessionId,
      cwd: project,
    };
    const pre = await runProcess(process.execPath, [preHook], {
      cwd: project,
      env,
      timeoutMs,
      input: JSON.stringify({
        ...commonInput,
        hook_event_name: "BeforeAgent",
        prompt: "Implement a deterministic tracked-turn acceptance fixture and verify it.",
      }),
    });
    const preOutput = parseLastJsonLine(pre.stdout);
    const context = preOutput?.hookSpecificOutput?.additionalContext;
    assert.equal(typeof context, "string", `Pre-prompt hook returned no tracking context: ${pre.stdout}`);
    const promptId = context.match(/Tracking ID: ([^.\s]+)/u)?.[1];
    assert.ok(promptId, `Pre-prompt hook returned no tracking ID: ${context}`);

    const post = await runProcess(process.execPath, [postHook], {
      cwd: project,
      env,
      timeoutMs,
      input: JSON.stringify({
        ...commonInput,
        hook_event_name: "AfterAgent",
        prompt_response: "Tracked-turn acceptance completed.",
        status: "completed",
      }),
    });
    assert.deepEqual(parseLastJsonLine(post.stdout), { decision: "allow" });

    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
      const linkage = database.prepare(`
        SELECT
          p.id AS prompt_id,
          p.raw_prompt,
          e.id AS execution_id,
          e.status,
          e.result_summary,
          pe.id AS prompt_event_id
        FROM prompts p
        JOIN executions e ON e.prompt_id = p.id
        JOIN events pe ON pe.prompt_id = p.id AND pe.event_type = 'prompt_received'
        WHERE p.id = ?
      `).get(promptId);
      assert.ok(linkage, `SQLite has no linked prompt/execution/event rows for ${promptId}.`);
      assert.equal(linkage.status, "completed");
      assert.match(linkage.result_summary, /acceptance completed the tracked turn/u);

      return { databasePath, promptId, linkage };
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
  const result = await runTrackedTurnAcceptance();
  console.log(`Real-process tracked turn passed: ${result.promptId} linked in SQLite.`);
}
