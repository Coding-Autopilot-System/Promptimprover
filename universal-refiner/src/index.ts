#!/usr/bin/env node
import { PromptRefinerServer } from "./core/server.js";
import { CommandCenterDashboard } from "./core/dashboard.js";
import { FileWatcher } from "./watcher/index.js";
import { RuntimeLogger } from "./core/logger.js";
import * as path from "path";

// Start the Web Dashboard in the background
const port = parseInt(process.env.PORT || "3000", 10);
const rootPath = path.resolve(process.cwd());
CommandCenterDashboard.start(port, rootPath);

const server = new PromptRefinerServer(rootPath);

// Phase 1 (AUTO-01, AUTO-02): Real-time file system watcher
// Starts watching for meaningful source/prompt file changes and logs them.
const fileWatcher = new FileWatcher(rootPath);
fileWatcher.on("change", (evt) => {
  RuntimeLogger.info(`[FS] ${evt.event}: ${evt.path}`);
  CommandCenterDashboard.log(`[FS] ${evt.event}: ${path.relative(rootPath, evt.path)}`);
});
fileWatcher.start();

server.run().catch((error) => {
  console.error("[FATAL ERROR]", error);
  process.exit(1);
});
