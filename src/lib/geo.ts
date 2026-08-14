import type { CommuteMode } from "./types";

const EARTH_RADIUS_KM = 6371;

/** Straight-line (haversine) distance in kilometers. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function kmToMiles(km: number): number {
  return km * 0.621371;
}

/**
 * Street networks are never straight lines; 1.3 is a standard urban
 * route-factor applied to the haversine distance.
 */
const ROUTE_FACTOR = 1.3;

/** Average speeds used to estimate commutes. Stated in the UI. */
const SPEED_KMH: Record<CommuteMode, number> = {
  walking: 4.8, // ~3 mph
  driving: 28, // urban average incl. lights and parking approach
};

export function commuteMinutes(
  distanceKm: number,
  mode: CommuteMode
): number {
  return (distanceKm * ROUTE_FACTOR * 60) / SPEED_KMH[mode];
}

export const SEARCH_RADIUS_MILES = 20;

export function formatMiles(miles: number): string {
  return miles < 0.1 ? "< 0.1 mi" : `${miles.toFixed(1)} mi`;
}

export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  return `${m} min`;
}
