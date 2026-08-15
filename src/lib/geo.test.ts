import { describe, it, expect } from "vitest";
import { commuteRadiusKm, kmToMiles } from "./geo";

describe("commuteRadiusKm", () => {
  it("inverts the walking estimate", () => {
    expect(commuteRadiusKm(20, "walking")).toBeCloseTo(1.231, 2);
  });
  it("inverts the driving estimate", () => {
    expect(commuteRadiusKm(15, "driving")).toBeCloseTo(5.385, 2);
  });
  it("clamps to the 20-mile hard radius", () => {
    expect(kmToMiles(commuteRadiusKm(600, "driving"))).toBeCloseTo(20, 5);
  });
});
