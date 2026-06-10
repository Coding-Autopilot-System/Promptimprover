import { describe, expect, it } from "vitest";
import { resolveDashboardHost } from "../src/core/dashboard.js";

describe("dashboard network binding", () => {
  it("binds to loopback by default", () => {
    expect(resolveDashboardHost(undefined)).toBe("127.0.0.1");
  });

  it("allows an explicit operator-configured host", () => {
    expect(resolveDashboardHost("0.0.0.0")).toBe("0.0.0.0");
  });

  it("does not accept an empty host override", () => {
    expect(resolveDashboardHost("   ")).toBe("127.0.0.1");
  });
});