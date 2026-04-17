#!/usr/bin/env node
import { PromptRefinerServer } from "./core/server.js";
import { CommandCenterDashboard } from "./core/dashboard.js";
// Start the Web Dashboard in the background
CommandCenterDashboard.start(3000);
const server = new PromptRefinerServer();
server.run().catch((error) => {
    console.error("[FATAL ERROR]", error);
    process.exit(1);
});
