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
    expect(isExcludedByName("Jamba Juice")).toBe(true);
  });

  it("accepts genuine dining venues", () => {
    expect(isExcludedByName("Carmine's Italian Restaurant")).toBe(false);
    expect(isExcludedByName("Keens Steakhouse")).toBe(false);
    expect(isExcludedByName("Le Bernardin")).toBe(false);
    expect(isExcludedByName("Le Marais")).toBe(false);
  });

  it("does not match a chain name embedded inside a longer word", () => {
    // Regression: raw substring matching on "jamba" used to false-reject a
    // genuine Cajun restaurant because "jamba" is a substring of "jambalaya".
    expect(isExcludedByName("Mama's Jambalaya House")).toBe(false);
  });

  it("no longer excludes on the generic 'candy' pattern", () => {
    expect(isExcludedByName("Rock Candy Kitchen")).toBe(false);
  });

  it("matches the plural of a singular-only pattern", () => {
    // Regression: the \b...\b word-boundary change silently narrowed every
    // singular-only pattern, so "donut" stopped matching "Donuts" and
    // "kiosk" stopped matching "Kiosks". Only "concession" was covered,
    // because a test happened to exercise its already-plural entry.
    expect(isExcludedByName("Krispy Kreme Donuts")).toBe(true);
  });

  it("still rejects a concessions stand now that the plural is implicit", () => {
    // "concessions" was removed as a redundant explicit entry once the
    // pattern gained an optional trailing "s" — this must keep passing.
    expect(isExcludedByName("Sandbar Concessions Inc")).toBe(true);
  });

  it("the plural suffix does not reintroduce the substring problem", () => {
    expect(isExcludedByName("Mama's Jambalaya House")).toBe(false);
    expect(isExcludedByName("Rock Candy Kitchen")).toBe(false);
  });
});
