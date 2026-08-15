import { parsePriceLevel } from "./tripadvisor-parse";

const BASE = "https://terra.tripadvisor.com/api";
const REVALIDATE_SECONDS = 86_400;
/** Terra's hard page ceiling. */
const MAX_PAGE_SIZE = 20;
/**
 * Stop paging even if the quota is unfilled — every location billed. Raised
 * from 3 to 4 so the plausible-venue filter still has room to fill 10 slots.
 */
const MAX_PAGES = 4;

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

/**
 * A venue with no rating, a very low one, or almost no reviews is usually a
 * stub listing, a closed location, or a concession counter — not somewhere a
 * planner can hold an event. Terra's own min_rating filter is ignored by the
 * API, so this has to happen client-side.
 */
const MIN_RATING = 3.5;
const MIN_REVIEWS = 10;

export function isPlausibleVenue(
  rating: number | null,
  reviewCount: number | null
): boolean {
  if (rating === null || reviewCount === null) return false;
  return rating >= MIN_RATING && reviewCount >= MIN_REVIEWS;
}

/**
 * The owner wants dining experiences, not fast food. Terra's own price_level
 * puts fast food in "Cheap Eats" (tier 1), so excluding that tier is a
 * principled filter rather than a taste judgement. A null tier is allowed
 * through: Terra simply has not classified the venue, and discarding every
 * unclassified restaurant would lose real ones.
 */
export function isDiningExperience(priceTier: number | null): boolean {
  return priceTier !== 1;
}

/**
 * Applied to nearby results before any details call, so excluded venues cost
 * nothing beyond the page they arrived on. Substring matching on a normalised
 * name: crude, but the alternative is paying for a details call on every
 * Dunkin' in the radius. Terra offers no category or cuisine field to do this
 * properly — its documented category filter is accepted and ignored.
 */
const EXCLUDED_NAME_PATTERNS = [
  // Fast food
  "mcdonald", "burger king", "kfc", "kentucky fried", "popeyes", "taco bell",
  "wendy", "subway", "chipotle", "shake shack", "in-n-out", "in n out",
  "raising cane", "five guys", "chick-fil-a", "chick fil a", "domino",
  "papa john", "pizza hut", "little caesar", "arby", "sonic drive",
  "jack in the box", "whataburger", "white castle", "del taco",
  "panda express", "jimmy john", "firehouse subs", "potbelly", "sbarro",
  "quiznos", "checkers", "el pollo loco",
  // Coffee and drinks
  "starbucks", "dunkin", "tim horton", "peet's coffee", "caribou coffee",
  "costa coffee", "boba", "bubble tea", "gong cha", "kung fu tea", "chatime",
  "coco fresh", "tiger sugar", "sharetea", "happy lemon", "jamba",
  "smoothie king", "juice bar",
  // Dessert
  "haagen", "häagen", "ben & jerry", "baskin", "cold stone", "dairy queen",
  "krispy kreme", "cinnabon", "insomnia cookies", "crumbl", "gelato",
  "ice cream", "frozen yogurt", "froyo", "donut", "doughnut", "cupcake",
  "macaron", "candy", "chocolatier",
  // Not a dining venue at all
  "concession", "food court", "kiosk",
];

export function isExcludedByName(name: string): boolean {
  const n = name.toLowerCase();
  return EXCLUDED_NAME_PATTERNS.some((p) => n.includes(p));
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
      const rating = loc.overall_rating?.rating ?? null;
      const review_count = loc.overall_rating?.count ?? null;
      if (!isPlausibleVenue(rating, review_count)) continue;
      const name = primaryName(loc.names);
      if (isExcludedByName(name)) continue;
      const rLat = loc.coordinates?.latitude;
      const rLng = loc.coordinates?.longitude;
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
      out.push({
        id: String(loc.id),
        name,
        address: loc.addresses?.[0]?.formatted ?? "",
        city: loc.addresses?.[0]?.city ?? "",
        lat: rLat as number,
        lng: rLng as number,
        rating,
        review_count,
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
