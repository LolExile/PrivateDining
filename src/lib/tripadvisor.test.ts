import { describe, it, expect } from "vitest";
import { isRestaurant } from "./tripadvisor";

describe("isRestaurant", () => {
  it("accepts a restaurant review URL", () => {
    expect(
      isRestaurant(
        "https://www.tripadvisor.com/Restaurant_Review-g60763-d5041840-Reviews-Bucca_Di_Beppo.html"
      )
    ).toBe(true);
  });

  it("rejects an attraction review URL", () => {
    expect(
      isRestaurant(
        "https://www.tripadvisor.com/Attraction_Review-g60763-d12484443-Reviews-Parrott_Tours.html"
      )
    ).toBe(false);
  });

  it("rejects null, undefined and empty", () => {
    expect(isRestaurant(null)).toBe(false);
    expect(isRestaurant(undefined)).toBe(false);
    expect(isRestaurant("")).toBe(false);
  });
});
