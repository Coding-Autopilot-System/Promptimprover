#!/usr/bin/env node

import path from "node:path";
import { EventStore } from "../../dist/src/history/event-store.js";

const [operation, destination] = process.argv.slice(2);

if (!["backup", "restore"].includes(operation) || !destination) {
  console.error("Usage: event-store-recovery.mjs <backup|restore> <path>");
  process.exitCode = 2;
} else {
  const resolvedPath = path.resolve(destination);
  try {
    if (operation === "backup") {
      const store = EventStore.getInstance();
      await store.backup(resolvedPath);
      store.close();
      console.log(`EventStore backup created: ${resolvedPath}`);
    } else {
      const store = EventStore.restore(resolvedPath);
      store.close();
      console.log(`EventStore restored from: ${resolvedPath}`);
    }
  } catch (error) {
    console.error(`EventStore ${operation} failed:`, error);
    process.exitCode = 1;
  }
}
