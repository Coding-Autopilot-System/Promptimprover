#!/usr/bin/env node
import { PromptRefinerServer } from "./core/server.js";
import { CommandCenterDashboard } from "./core/dashboard.js";
import { FileWatcher } from "./watcher/index.js";
import { RuntimeLogger } from "./core/logger.js";
import * as path from "path";
import { AgenticBlackboard } from "./core/blackboard.js";
import { EventStore } from "./history/event-store.js";
import { resolveDashboardPort } from "./core/ports.js";

const port = resolveDashboardPort();
const rootPath = path.resolve(process.cwd());
const backgroundMode = process.env.PROMPT_REFINER_BACKGROUND === "true";
if (backgroundMode) {
  CommandCenterDashboard.start(port, rootPath);
}

const server = new PromptRefinerServer(rootPath);

const fileWatcher = backgroundMode ? new FileWatcher(rootPath) : null;
fileWatcher?.on("change", (evt) => {
  RuntimeLogger.info(`[FS] ${evt.event}: ${evt.path}`);
  CommandCenterDashboard.log(`[FS] ${evt.event}: ${path.relative(rootPath, evt.path)}`);
});
fileWatcher?.start();

let shuttingDown = false;
async function shutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  RuntimeLogger.info("Prompt Refiner shutdown started", { reason });
  await fileWatcher?.stop();
  await server.stop();
  await AgenticBlackboard.flushPendingWrites();
  await CommandCenterDashboard.stop();
  EventStore.getInstance().close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
process.stdin.once("end", () => {
  if (!backgroundMode) void shutdown("stdin-end");
});

server.run({ background: backgroundMode }).catch((error) => {
  console.error("[FATAL ERROR]", error);
  void shutdown("fatal-error").finally(() => process.exit(1));
});
