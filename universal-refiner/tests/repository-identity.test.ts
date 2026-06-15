import { describe, expect, it } from "vitest";
import { resolveRepositoryIdentity } from "../src/history/repository-identity.js";

describe("resolveRepositoryIdentity", () => {
  it("distinguishes same-named repositories at different paths", () => {
    const first = resolveRepositoryIdentity("C:/repo/team-a/service");
    const second = resolveRepositoryIdentity("C:/repo/team-b/service");
    expect(first.legacyId).toBe(second.legacyId);
    expect(first.id).not.toBe(second.id);
  });

  it("normalizes path casing and separators", () => {
    expect(resolveRepositoryIdentity("C:\\Repo\\Service").id).toBe(resolveRepositoryIdentity("c:/repo/service").id);
  });
});
