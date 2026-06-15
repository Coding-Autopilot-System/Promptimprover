import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["hooks/lib/**/*.ts", "src/**/*.ts"],
      exclude: ["src/core/generated-version.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
