import { parsePriceLevel } from "./tripadvisor-parse";

const BASE = "https://terra.tripadvisor.com/api";
const REVALIDATE_SECONDS = 86_400;
/** Terra's hard page ceiling. */
const MAX_PAGE_SIZE = 20;
/** Stop paging even if the quota is unfilled — every location billed. */
const MAX_PAGES = 3;

export class TripAdvisorError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TripAdvisorError";
  }
}

export interface TerraNearby {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  rating: number | null;
  review_count: number | null;
  ratingImageUrl: string | null;
  taUrl: string | null;
  website: string | null;
  distanceKm: number | null;
}

export interface TerraDetails {
  phone: string | null;
  website: string | null;
  price_tier: number | null;
  street_address: string | null;
  rating: number | null;
  review_count: number | null;
  ratingImageUrl: string | null;
}

function apiKey(): string {
  const key = process.env.TRIPADVISOR_API_KEY;
  if (!key) throw new TripAdvisorError("TRIPADVISOR_API_KEY is not set", 0);
  return key;
}

async function terra(path: string, params: Record<string, string>) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "X-API-Key": apiKey(), accept: "application/json" },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? "Tripadvisor rejected the key. Check TRIPADVISOR_API_KEY in .env.local."
        : await res.text().catch(() => res.statusText);
    throw new TripAdvisorError(hint, res.status);
  }
  return res.json();
}

/** Terra's documented category filter is not applied; this is the reliable test. */
export function isRestaurant(main: string | null | undefined): boolean {
  return /\/Restaurant_Review/.test(main ?? "");
}

function primaryName(names: { value: string; primary?: boolean }[] = []): string {
  return (names.find((n) => n.primary) ?? names[0])?.value ?? "";
}

interface RawNearby {
  distance_kilometers?: number;
  location: {
    id: number | string;
    names?: { value: string; primary?: boolean }[];
    addresses?: { formatted?: string; city?: string }[];
    coordinates?: { latitude?: number; longitude?: number };
    overall_rating?: { rating?: number; count?: number; icon_url?: string };
    urls?: { tripadvisor?: { main?: string }; official?: string };
  };
}

/**
 * Pages Terra's nearby catalog collecting restaurants. The documented
 * `category=RESTAURANT` is validated but not applied, so every page is filtered
 * client-side. Paging stops the moment `needed` restaurants are collected —
 * every extra location in a response is a billable entity.
 */
export async function nearbyRestaurants(
  lat: number,
  lng: number,
  radiusKm: number,
  needed: number
): Promise<TerraNearby[]> {
  const out: TerraNearby[] = [];
  for (let page = 1; page <= MAX_PAGES && out.length < needed; page++) {
    const json = (await terra("/catalog/locations/nearby", {
      lat: String(lat),
      lon: String(lng),
      radius: String(radiusKm),
      unit: "KM",
      size: String(MAX_PAGE_SIZE),
      page: String(page),
      sort: "distance,asc",
    })) as { data?: RawNearby[] };

    const rows = json.data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const loc = row.location;
      const main = loc?.urls?.tripadvisor?.main ?? null;
      if (!isRestaurant(main)) continue;
      const rLat = loc.coordinates?.latitude;
      const rLng = loc.coordinates?.longitude;
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
      out.push({
        id: String(loc.id),
        name: primaryName(loc.names),
        address: loc.addresses?.[0]?.formatted ?? "",
        city: loc.addresses?.[0]?.city ?? "",
        lat: rLat as number,
        lng: rLng as number,
        rating: loc.overall_rating?.rating ?? null,
        review_count: loc.overall_rating?.count ?? null,
        ratingImageUrl: loc.overall_rating?.icon_url ?? null,
        taUrl: main,
        website: loc.urls?.official ?? null,
        distanceKm: row.distance_kilometers ?? null,
      });
      if (out.length >= needed) break;
    }
  }
  return out;
}

interface RawDetails {
  id?: number | string;
  phone_numbers?: { value?: string }[];
  addresses?: { street_address?: string }[];
  price_level?: string;
  urls?: { official?: string };
  traveler_ratings?: {
    overall?: { rating?: number; count?: number; icon_url?: string };
  };
}

export async function locationDetails(id: string): Promise<TerraDetails | null> {
  const j = (await terra(`/locations/${id}`, {})) as RawDetails;
  if (!j || j.id === undefined) return null;
  return {
    phone: j.phone_numbers?.[0]?.value ?? null,
    website: j.urls?.official ?? null,
    price_tier: parsePriceLevel(j.price_level),
    street_address: j.addresses?.[0]?.street_address ?? null,
    rating: j.traveler_ratings?.overall?.rating ?? null,
    review_count: j.traveler_ratings?.overall?.count ?? null,
    ratingImageUrl: j.traveler_ratings?.overall?.icon_url ?? null,
  };
}

interface RawPhotos {
  data?: { photo?: { original_size_url?: string } }[];
}

/**
 * First photo only. Reviews are deliberately never fetched: they cost billable
 * entities and nothing in the app ranks on them.
 */
export async function locationPhoto(id: string): Promise<string | null> {
  const j = (await terra(`/locations/${id}/photos`, { size: "1" })) as RawPhotos;
  return j.data?.[0]?.photo?.original_size_url ?? null;
}
