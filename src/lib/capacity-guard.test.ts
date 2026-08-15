import { describe, it, expect } from "vitest";
import { acceptRoomBlock, confidenceFor, type ExtractedBlock } from "./capacity-guard";

const carmines = {
  city: "New York",
  address: "200 W 44th St, New York, NY 10036",
  neighbourhood: "Times Square",
};

const block = (o: Partial<ExtractedBlock>): ExtractedBlock => ({
  name: "Room", seated: null, standing: null, notes: null,
  location_match: null, ...o,
});

describe("acceptRoomBlock", () => {
  it("accepts a block matching the venue city", () => {
    expect(acceptRoomBlock(
      block({ name: "Private Dining Room", seated: 200, location_match: "Times Square, NYC" }),
      carmines
    )).toBe(true);
  });

  it("rejects another city in the same restaurant group", () => {
    expect(acceptRoomBlock(
      block({ name: "8 Private Dining Rooms", location_match: "Washington D.C." }),
      carmines
    )).toBe(false);
    expect(acceptRoomBlock(
      block({ name: "Private Room", location_match: "Atlantic City, NJ" }),
      carmines
    )).toBe(false);
    expect(acceptRoomBlock(
      block({ name: "4 Private Dining Rooms", location_match: "Las Vegas, NV" }),
      carmines
    )).toBe(false);
  });

  it("rejects a different branch in the same city", () => {
    expect(acceptRoomBlock(
      block({ name: "The Bellini", seated: 42, location_match: "Upper West Side, NYC" }),
      carmines
    )).toBe(false);
  });

  it("accepts a block matching the street address", () => {
    expect(acceptRoomBlock(
      block({ name: "The Sinatra Room", location_match: "200 W 44th St" }),
      carmines
    )).toBe(true);
  });

  it("accepts an unattributed block — a single-location page names no city", () => {
    expect(acceptRoomBlock(block({ name: "Back Room", seated: 30 }), carmines)).toBe(true);
  });
});

describe("confidenceFor", () => {
  it("is likely when any room has a number", () => {
    expect(confidenceFor([{ seated: null, standing: null }, { seated: 30, standing: null }]))
      .toBe("likely");
  });

  it("is unverified when no room has a number", () => {
    expect(confidenceFor([{ seated: null, standing: null }])).toBe("unverified");
  });

  it("is unverified for an empty list", () => {
    expect(confidenceFor([])).toBe("unverified");
  });
});
