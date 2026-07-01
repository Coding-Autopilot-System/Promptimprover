import { describe, expect, it } from "vitest";

import { resolveDashboardPort } from "../src/core/ports.js";

describe("resolveDashboardPort", () => {
  it("uses the dedicated port, generic fallback, and default in priority order", () => {
    expect(resolveDashboardPort({ PROMPT_REFINER_DASHBOARD_PORT: "4100", PORT: "4200" })).toBe(4100);
    expect(resolveDashboardPort({ PORT: "4200" })).toBe(4200);
    expect(resolveDashboardPort({})).toBe(3000);
  });

  it.each(["0", "65536", "not-a-number", "1.5"])("rejects invalid port %s", (value) => {
    expect(() => resolveDashboardPort({ PROMPT_REFINER_DASHBOARD_PORT: value })).toThrow(
      `Invalid dashboard port: ${value}`,
    );
  });
});
