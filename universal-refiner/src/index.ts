#!/usr/bin/env node
import { PromptRefinerServer } from "./core/server.js";
import { CommandCenterDashboard } from "./core/dashboard.js";
import { CommitIngester } from "./history/commit-ingest.js";
import { CorrelationEngine } from "./history/correlation-engine.js";
import { LessonExtractor } from "./history/lesson-extractor.js";
import * as path from "path";

// Start the Web Dashboard in the background
const port = parseInt(process.env.PORT || "3000", 10);
const rootPath = path.resolve(process.cwd());
CommandCenterDashboard.start(port, rootPath);

const server = new PromptRefinerServer(rootPath);

// Initial background ingestion and correlation
async function runBackgroundTasks() {
  await CommitIngester.ingestLatest(rootPath);
  const correlation = new CorrelationEngine();
  await correlation.correlateAll();
  
  const extractor = new LessonExtractor((task, prompt, tokens) => server.requestModelText(task, prompt, tokens));
  await extractor.extractNewLessons();
}
void runBackgroundTasks();
server.run().catch((error) => {
  console.error("[FATAL ERROR]", error);
  process.exit(1);
});
