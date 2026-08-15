import { describe, it, expect } from "vitest";
import {
  isDiningExperience,
  isExcludedByName,
  isPlausibleVenue,
  isRestaurant,
} from "./tripadvisor";

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

describe("isDiningExperience", () => {
  it("rejects Cheap Eats (tier 1)", () => {
    expect(isDiningExperience(1)).toBe(false);
  });

  it("accepts Mid Range (tier 2)", () => {
    expect(isDiningExperience(2)).toBe(true);
  });

  it("accepts Fine Dining (tier 4)", () => {
    expect(isDiningExperience(4)).toBe(true);
  });

  it("accepts a null tier rather than discarding an unclassified venue", () => {
    expect(isDiningExperience(null)).toBe(true);
  });
});

describe("isExcludedByName", () => {
  it("rejects fast food, coffee and dessert chains", () => {
    expect(isExcludedByName("McDonald's")).toBe(true);
    expect(isExcludedByName("Raising Cane's Chicken Fingers")).toBe(true);
    expect(isExcludedByName("Starbucks - #1535 BRDWY")).toBe(true);
    expect(isExcludedByName("Häagen-Dazs")).toBe(true);
    expect(isExcludedByName("I'm Donut ?")).toBe(true);
    expect(isExcludedByName("Sandbar Concessions Inc")).toBe(true);
  });

  it("accepts genuine dining venues", () => {
    expect(isExcludedByName("Carmine's Italian Restaurant")).toBe(false);
    expect(isExcludedByName("Keens Steakhouse")).toBe(false);
    expect(isExcludedByName("Le Bernardin")).toBe(false);
  });
});
