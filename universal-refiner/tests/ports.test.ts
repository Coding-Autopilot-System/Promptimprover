import { describe, expect, it } from "vitest";
import { OPERATOR_DASHBOARD_PORT, resolveDashboardPort } from "../src/core/ports.js";

describe("dashboard port policy", () => {
  it("uses the fixed operator dashboard port by default", () => {
    expect(OPERATOR_DASHBOARD_PORT).toBe(3000);
    expect(resolveDashboardPort(undefined, undefined)).toBe(3000);
  });

  it("prefers the named dashboard port over legacy PORT", () => {
    expect(resolveDashboardPort("3000", "4321")).toBe(3000);
  });

  it("keeps legacy PORT as a compatibility fallback and rejects invalid values", () => {
    expect(resolveDashboardPort(undefined, "3999")).toBe(3999);
    expect(resolveDashboardPort("not-a-port", "3999")).toBe(3000);
    expect(resolveDashboardPort("70000", undefined)).toBe(3000);
  });
});
