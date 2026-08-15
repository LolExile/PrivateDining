import { describe, it, expect } from "vitest";
import { parsePriceLevel } from "./tripadvisor-parse";

describe("parsePriceLevel", () => {
  it("maps Terra's labels", () => {
    expect(parsePriceLevel("Cheap Eats")).toBe(1);
    expect(parsePriceLevel("Mid Range")).toBe(2);
    expect(parsePriceLevel("Fine Dining")).toBe(4);
  });

  it("is case and hyphen tolerant", () => {
    expect(parsePriceLevel("  mid range ")).toBe(2);
    expect(parsePriceLevel("Mid-Range")).toBe(2);
  });

  it("returns null for an unrecognised label rather than guessing", () => {
    expect(parsePriceLevel("Gastropub")).toBeNull();
  });

  it("still understands the legacy dollar form", () => {
    expect(parsePriceLevel("$$ - $$$")).toBe(3);
    expect(parsePriceLevel("$$$$$$")).toBe(4);
  });

  it("returns null for null, undefined and empty", () => {
    expect(parsePriceLevel(null)).toBeNull();
    expect(parsePriceLevel(undefined)).toBeNull();
    expect(parsePriceLevel("")).toBeNull();
  });
});
