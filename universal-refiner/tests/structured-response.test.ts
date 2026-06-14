import { describe, expect, it } from "vitest";
import { parseStructuredResponse } from "../src/core/structured-response.js";

describe("parseStructuredResponse", () => {
  it("parses direct JSON", () => {
    expect(parseStructuredResponse<{ ready: boolean }>('{"ready":true}')).toEqual({ ready: true });
  });

  it("parses fenced JSON from local models", () => {
    expect(parseStructuredResponse<{ ready: boolean }>('```json\n{"ready":true}\n```')).toEqual({ ready: true });
  });

  it("extracts JSON after bounded explanatory text", () => {
    expect(parseStructuredResponse<string[]>('Result:\n["one","two"]')).toEqual(["one", "two"]);
  });

  it("rejects responses without JSON", () => {
    expect(() => parseStructuredResponse("not structured")).toThrow(/JSON/);
  });
});
