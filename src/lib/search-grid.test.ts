import { describe, it, expect } from "vitest";
import { commuteRadiusKm, searchGrid } from "./search-grid";
import { haversineKm, kmToMiles } from "./geo";

describe("commuteRadiusKm", () => {
  it("inverts the commute estimate for walking", () => {
    // 20 min walking at 4.8 km/h with a 1.3 route factor => ~1.23 km
    expect(commuteRadiusKm(20, "walking")).toBeCloseTo(1.231, 2);
  });

  it("inverts the commute estimate for driving", () => {
    expect(commuteRadiusKm(15, "driving")).toBeCloseTo(5.385, 2);
  });

  it("clamps to the 20-mile hard radius", () => {
    expect(kmToMiles(commuteRadiusKm(600, "driving"))).toBeCloseTo(20, 5);
  });
});

describe("searchGrid", () => {
  it("returns the centre plus two rings of six", () => {
    const points = searchGrid(40.758, -73.9855, 2);
    expect(points).toHaveLength(13);
    expect(points[0]).toEqual({ lat: 40.758, lng: -73.9855 });
  });

  it("offsets the outer ring between the inner ring's points", () => {
    const points = searchGrid(40.758, -73.9855, 2);
    const inner = points.slice(1, 7);
    const outer = points.slice(7, 13);
    // No outer point should sit on the same bearing as an inner one.
    for (const o of outer) {
      const coincident = inner.some(
        (i) =>
          Math.abs(i.lat - o.lat) < 1e-9 && Math.abs(i.lng - o.lng) < 1e-9
      );
      expect(coincident).toBe(false);
    }
  });

  it("places ring points inside the radius", () => {
    const [lat, lng, radiusKm] = [40.758, -73.9855, 2];
    for (const p of searchGrid(lat, lng, radiusKm).slice(1)) {
      expect(haversineKm(lat, lng, p.lat, p.lng)).toBeLessThan(radiusKm);
    }
  });

  it("spreads ring points apart from each other", () => {
    const ring = searchGrid(40.758, -73.9855, 2).slice(1);
    const d = haversineKm(ring[0].lat, ring[0].lng, ring[1].lat, ring[1].lng);
    expect(d).toBeGreaterThan(0.5);
  });
});
