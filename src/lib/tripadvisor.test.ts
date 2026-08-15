import { describe, it, expect } from "vitest";
import { isPlausibleVenue, isRestaurant } from "./tripadvisor";

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

describe("isPlausibleVenue", () => {
  it("accepts a well-reviewed venue", () => {
    expect(isPlausibleVenue(4.1, 500)).toBe(true);
  });

  it("rejects a low rating even with many reviews", () => {
    expect(isPlausibleVenue(3.4, 2000)).toBe(false);
  });

  it("rejects a high rating with too few reviews", () => {
    expect(isPlausibleVenue(4.8, 3)).toBe(false);
  });

  it("rejects a null rating", () => {
    expect(isPlausibleVenue(null, 500)).toBe(false);
  });

  it("rejects a null review count", () => {
    expect(isPlausibleVenue(4.5, null)).toBe(false);
  });
});
