import { describe, it, expect } from "vitest";
import { rankVenues } from "./ranking";
import type { SearchParams, Venue, Room } from "./types";

function venue(overrides: Partial<Venue>): Venue {
  return {
    id: "v1", name: "Test", address: "1 Main St", city: "New York",
    region: "nyc", lat: 40.7576, lng: -73.987, cuisine: "Italian",
    description: null, rating: 4, review_count: 100, price_tier: 2,
    trust_label: "unverified",
    dietary: [], event_styles: ["seated"], image_url: null, menu_url: null,
    menu_image_url: null, menu_highlights: [],
    contact: { name: null, email: null, phone: null },
    rooms: [], ta_location_id: null, ta_url: null,
    ta_rating_image_url: null, capacity_source_url: null,
    ...overrides,
  };
}

const room = (o: Partial<Room>): Room => ({
  name: "Room", seated: null, standing: null, notes: null, ...o,
});

const params: SearchParams = {
  address: "Times Square", lat: 40.7580, lng: -73.9855, headcount: 50,
  maxCommuteMinutes: 20, commuteMode: "walking", eventStyle: "seated",
  cuisine: null, dietary: [],
};

describe("rankVenues with unknown capacities", () => {
  it("scores an unknown-capacity room above a known too-small one", () => {
    const unknown = venue({ id: "unknown", rooms: [room({ name: "Back Room" })] });
    const tooSmall = venue({ id: "small", rooms: [room({ name: "Nook", seated: 4 })] });
    const { results } = rankVenues([tooSmall, unknown], params);
    expect(results[0].venue.id).toBe("unknown");
  });

  it("reports capacityOk false when capacity is unknown", () => {
    const { results } = rankVenues([venue({ rooms: [room({ name: "Back Room" })] })], params);
    expect(results[0].capacityOk).toBe(false);
    expect(results[0].factors.find((f) => f.key === "capacity")?.detail)
      .toBe("Back Room — capacity unconfirmed");
  });

  it("still prefers a room that actually fits", () => {
    const fits = venue({ id: "fits", rooms: [room({ name: "Hall", seated: 60 })] });
    const unknown = venue({ id: "unknown", rooms: [room({ name: "Back Room" })] });
    const { results } = rankVenues([unknown, fits], params);
    expect(results[0].venue.id).toBe("fits");
    expect(results[0].capacityOk).toBe(true);
  });

  it("picks the smallest room that fits", () => {
    const v = venue({
      rooms: [room({ name: "Ballroom", seated: 200 }), room({ name: "Salon", seated: 60 })],
    });
    expect(rankVenues([v], params).results[0].bestRoom?.name).toBe("Salon");
  });
});
