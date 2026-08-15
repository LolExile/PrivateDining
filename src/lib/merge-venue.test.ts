import { describe, it, expect } from "vitest";
import { mergeVenue, type CapacityEntry, type OverlayEntry } from "./merge-venue";
import type { TerraDetails, TerraNearby } from "./tripadvisor";

const live: TerraNearby & Partial<TerraDetails> = {
  id: "123", name: "Carmine's", address: "200 W 44th St, New York, NY",
  city: "New York", lat: 40.7576, lng: -73.987,
  rating: 4.2, review_count: 5182, price_tier: 2, phone: "(212) 221-3800",
  website: "https://www.carminesnyc.com/", taUrl: "https://tripadvisor.com/x",
  ratingImageUrl: "https://tripadvisor.com/bubbles.png", distanceKm: 0.1,
};

const overlay: OverlayEntry = {
  ta_location_id: "123", id: "carmines-times-square",
  name: "Carmine's Italian Restaurant",
  address: "200 W 44th St, New York, NY 10036",
  lat: 40.7576, lng: -73.987, city: "New York",
  neighbourhood: "Times Square", region: "nyc", cuisine: "Italian",
  description: "Family-style Southern Italian.",
  dietary: ["vegetarian"], event_styles: ["seated"],
  menu_image_url: null, menu_highlights: [],
  contact: { name: "Group Sales", email: "groupsales@carminesnyc.com", phone: null },
  rooms: [{ name: "Palace Room", seated: 80, standing: 100, notes: null }],
};

const capacity: CapacityEntry = {
  ta_location_id: "123",
  rooms: [{ name: "Back Room", seated: 30, standing: null, notes: null }],
  source_url: "https://www.carminesnyc.com/parties",
  confidence: "likely",
};

describe("mergeVenue", () => {
  it("takes public signals from the live record", () => {
    const v = mergeVenue(live, undefined, undefined);
    expect(v.rating).toBe(4.2);
    expect(v.review_count).toBe(5182);
    expect(v.price_tier).toBe(2);
    expect(v.contact.phone).toBe("(212) 221-3800");
    expect(v.menu_url).toBe("https://www.carminesnyc.com/");
    expect(v.ta_url).toBe("https://tripadvisor.com/x");
  });

  it("marks a live-only venue as needing a call", () => {
    const v = mergeVenue(live, undefined, undefined);
    expect(v.rooms).toEqual([]);
    expect(v.trust_label).toBe("unverified");
    expect(v.id).toBe("ta-123");
  });

  it("takes private-dining fields from the overlay and marks it verified", () => {
    const v = mergeVenue(live, overlay, undefined);
    expect(v.rooms).toHaveLength(1);
    expect(v.rooms[0].name).toBe("Palace Room");
    expect(v.contact.email).toBe("groupsales@carminesnyc.com");
    expect(v.trust_label).toBe("verified");
    expect(v.id).toBe("carmines-times-square");
  });

  it("keeps the live phone when the overlay has none", () => {
    const v = mergeVenue(live, overlay, undefined);
    expect(v.contact.phone).toBe("(212) 221-3800");
  });

  it("uses extracted capacity when there is no overlay", () => {
    const v = mergeVenue(live, undefined, capacity);
    expect(v.rooms[0].name).toBe("Back Room");
    expect(v.trust_label).toBe("likely");
    expect(v.capacity_source_url).toBe("https://www.carminesnyc.com/parties");
  });

  it("lets the overlay win over extracted capacity", () => {
    const v = mergeVenue(live, overlay, capacity);
    expect(v.rooms[0].name).toBe("Palace Room");
    expect(v.trust_label).toBe("verified");
    expect(v.capacity_source_url).toBeNull();
  });

  it("carries the unverified confidence through from extraction", () => {
    const v = mergeVenue(live, undefined, { ...capacity, confidence: "unverified" });
    expect(v.trust_label).toBe("unverified");
    expect(v.rooms).toHaveLength(1);
  });
});
