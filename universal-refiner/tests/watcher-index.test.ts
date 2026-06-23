import { describe, it, expect } from "vitest";
import { FileWatcher } from "../src/watcher/index.js";

describe("Watcher Index", () => {
  it("exports FileWatcher", () => {
    expect(FileWatcher).toBeDefined();
  });
});
