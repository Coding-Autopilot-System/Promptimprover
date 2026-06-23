import { EventStore } from "../src/history/event-store.js";
import { ObsidianOrchestrator } from "../src/integrations/obsidian/obsidian-orchestrator.js";
import { ConfigManager } from "../src/core/config.js";
import * as path from "path";
import * as fs from "fs";

/**
 * Historical Migration Script
 * Sweeps the EventStore (events.db) and pushes all old session data to the Obsidian Vault.
 */
async function migrate() {
  console.log("Starting Historical Migration to Obsidian...");
  
  // Force the orchestrator to use the global obsidian vault
  ConfigManager.getObsidianConfig = () => ({ vaultPath: "C:\\repo\\global.obsidian" });

  const store = EventStore.getInstance();
  const db = (store as any).db;

  // 1. Get all unique projects (repo_ids)
  const repos = db.prepare("SELECT DISTINCT repo_id FROM prompts WHERE repo_id IS NOT NULL").all() as { repo_id: string }[];
  console.log(`Found ${repos.length} projects with history.`);

  for (const { repo_id } of repos) {
    console.log(`\nMigrating project: ${repo_id}...`);
    
    // Simulate a rootPath for the orchestrator (it uses basename(rootPath) as repoId)
    // We'll use a dummy path that ends with the repo_id
    const dummyRootPath = `C:\\repo\\${repo_id}`;

    // 2. Fetch all successful executions for this repo
    const executions = db.prepare(`
      SELECT p.raw_prompt, e.result_summary, e.ended_at, e.executor_name
      FROM prompts p
      JOIN executions e ON p.id = e.prompt_id
      WHERE p.repo_id = ? AND e.status = 'completed'
      ORDER BY e.ended_at ASC
    `).all(repo_id) as any[];

    console.log(`- Found ${executions.length} historical executions.`);

    for (const exec of executions) {
      const summary = `Historical: ${exec.result_summary || "Agent execution"}`;
      const rationale = `Prompt: ${exec.raw_prompt}\n\nExecutor: ${exec.executor_name}\nDate: ${new Date(exec.ended_at).toLocaleString()}`;
      
      await ObsidianOrchestrator.logActivity(dummyRootPath, summary, rationale);
    }

    // 3. Fetch all commits for this repo
    const commits = db.prepare(`
      SELECT message, committed_at, author, sha
      FROM commits
      WHERE repo_id = ?
      ORDER BY committed_at ASC
    `).all(repo_id) as any[];

    console.log(`- Found ${commits.length} historical commits.`);

    for (const commit of commits) {
      const summary = `Historical Commit: ${commit.sha.substring(0, 7)} - ${commit.message}`;
      const rationale = `Author: ${commit.author}\nDate: ${new Date(commit.committed_at).toLocaleString()}`;
      
      await ObsidianOrchestrator.logActivity(dummyRootPath, summary, rationale);
    }

    // 4. Sync lessons (Engineering Mandates)
    await ObsidianOrchestrator.syncToWiki(dummyRootPath);
  }

  console.log("\nMigration Complete!");
  process.exit(0);
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
