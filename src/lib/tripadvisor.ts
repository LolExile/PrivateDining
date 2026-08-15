import { parsePriceLevel } from "./tripadvisor-parse";

const BASE = "https://api.content.tripadvisor.com/api/v1";
/** 24h. Protects the 5,000-call monthly budget; see the spec's caching note. */
const REVALIDATE_SECONDS = 86_400;

export class TripAdvisorError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TripAdvisorError";
  }
}

export interface TaSearchHit {
  location_id: string;
  name: string;
  distanceKm: number | null;
}

export interface TaDetails {
  location_id: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  cuisine: string;
  rating: number | null;
  review_count: number | null;
  price_tier: number | null;
  phone: string | null;
  website: string | null;
  ta_url: string | null;
  ta_rating_image_url: string | null;
}

function apiKey(): string {
  const key = process.env.TRIPADVISOR_API_KEY;
  if (!key) {
    throw new TripAdvisorError("TRIPADVISOR_API_KEY is not set", 0);
  }
  return key;
}

async function taFetch(path: string, params: Record<string, string>) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: REVALIDATE_SECONDS },
  });

  if (!res.ok) {
    // 403 is overwhelmingly the IP allowlist, not a bad key — say so.
    const hint =
      res.status === 403
        ? "TripAdvisor rejected the key. Check that this server's public IPv4 is on the key's allowlist."
        : await res.text().catch(() => res.statusText);
    throw new TripAdvisorError(hint, res.status);
  }
  return res.json();
}

const MILES_TO_KM = 1.609344;

export async function nearbySearch(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<TaSearchHit[]> {
  const data = (await taFetch("/location/nearby_search", {
    latLong: `${lat},${lng}`,
    category: "restaurants",
    radius: String(Math.max(1, Math.round(radiusKm))),
    radiusUnit: "km",
  })) as { data?: { location_id: string; name: string; distance?: string }[] };

  return (data.data ?? []).map((hit) => ({
    location_id: String(hit.location_id),
    name: hit.name,
    // TripAdvisor reports distance in miles.
    distanceKm: hit.distance ? Number(hit.distance) * MILES_TO_KM : null,
  }));
}

interface RawDetails {
  location_id: string;
  name: string;
  latitude?: string;
  longitude?: string;
  address_obj?: { address_string?: string; city?: string };
  rating?: string;
  num_reviews?: string;
  price_level?: string;
  phone?: string;
  website?: string;
  web_url?: string;
  rating_image_url?: string;
  cuisine?: { name: string }[];
}

/** Returns null when the listing has no usable coordinates. */
export async function locationDetails(
  locationId: string
): Promise<TaDetails | null> {
  const raw = (await taFetch(`/location/${locationId}/details`, {
    language: "en",
    currency: "USD",
  })) as RawDetails;

  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    location_id: String(raw.location_id),
    name: raw.name,
    address: raw.address_obj?.address_string ?? "",
    city: raw.address_obj?.city ?? "",
    lat,
    lng,
    cuisine: raw.cuisine?.[0]?.name ?? "Restaurant",
    rating: raw.rating ? Number(raw.rating) : null,
    review_count: raw.num_reviews ? Number(raw.num_reviews) : null,
    price_tier: parsePriceLevel(raw.price_level),
    phone: raw.phone ?? null,
    // The restaurant's own site is a better menu link than the TA listing.
    website: raw.website ?? null,
    ta_url: raw.web_url ?? null,
    ta_rating_image_url: raw.rating_image_url ?? null,
  };
}
