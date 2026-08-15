import { SEARCH_RADIUS_MILES } from "./geo";
import type { CommuteMode } from "./types";

// Mirrors the constants in geo.ts; commuteRadiusKm is its inverse.
const ROUTE_FACTOR = 1.3;
const SPEED_KMH: Record<CommuteMode, number> = { walking: 4.8, driving: 28 };
const MAX_RADIUS_KM = SEARCH_RADIUS_MILES / 0.621371;

/** Straight-line radius reachable within the commute limit. */
export function commuteRadiusKm(
  maxCommuteMinutes: number,
  mode: CommuteMode
): number {
  const km = (maxCommuteMinutes * SPEED_KMH[mode]) / (ROUTE_FACTOR * 60);
  return Math.min(km, MAX_RADIUS_KM);
}

const RING_POINTS = 6;
/** Two rings: an inner sweep and an outer one closer to the radius edge. */
const RING_FRACTIONS = [0.5, 0.85];
const KM_PER_DEG_LAT = 110.574;

/**
 * TripAdvisor caps every search at 10 results with no pagination, so a single
 * query cannot fill a map. Centre plus two offset rings yields up to 130 raw
 * hits for 13 calls — enough that 20 still survive dedup, the radius filter,
 * and the commute limit.
 *
 * The second ring is offset half a step so its points sit between the inner
 * ring's, rather than radially behind them where their result sets overlap
 * most.
 */
export function searchGrid(
  lat: number,
  lng: number,
  radiusKm: number
): { lat: number; lng: number }[] {
  const points = [{ lat, lng }];
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  RING_FRACTIONS.forEach((fraction, ring) => {
    const ringKm = radiusKm * fraction;
    for (let i = 0; i < RING_POINTS; i++) {
      const angle = (2 * Math.PI * (i + ring * 0.5)) / RING_POINTS;
      points.push({
        lat: lat + (ringKm * Math.cos(angle)) / KM_PER_DEG_LAT,
        lng: lng + (ringKm * Math.sin(angle)) / kmPerDegLng,
      });
    }
  });
  return points;
}
