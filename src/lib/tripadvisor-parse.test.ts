import { describe, it, expect } from "vitest";
import { parsePriceLevel } from "./tripadvisor-parse";

describe("parsePriceLevel", () => {
  it("takes the upper bound of a range", () => {
    expect(parsePriceLevel("$$ - $$$")).toBe(3);
  });

  it("handles a single tier", () => {
    expect(parsePriceLevel("$$")).toBe(2);
  });

  it("clamps above four", () => {
    expect(parsePriceLevel("$$$$$$")).toBe(4);
  });

  it("returns null for null, undefined, and empty", () => {
    expect(parsePriceLevel(null)).toBeNull();
    expect(parsePriceLevel(undefined)).toBeNull();
    expect(parsePriceLevel("")).toBeNull();
  });

  it("returns null when there is no dollar sign", () => {
    expect(parsePriceLevel("moderate")).toBeNull();
  });
});
