# Live TripAdvisor Venues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Yelp enrichment pipeline and the seeded 38-venue catalog with live TripAdvisor Content API search, a curated private-dining overlay, and machine-extracted room capacities.

**Architecture:** A server-only Next.js route handler (`/api/venues/search`) fans out TripAdvisor `nearby_search` calls across a grid inside the commute radius, fetches `/location/{id}/details` for the nearest ~30 unique results, and merges each with a curated overlay (keyed by TripAdvisor `location_id`) and a `venue_capacity` cache of machine-extracted room data. The result is the existing `Venue[]` shape, so `rankVenues()`, `MapPanel`, and `VenueCard` consume it unchanged. The `venues`/`private_rooms` catalog tables are dropped; `reservations` gains venue snapshot columns.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (PostgreSQL) · TripAdvisor Content API · Anthropic SDK (`claude-opus-5`) + Zod for extraction · Vitest

**Spec:** `docs/superpowers/specs/2026-08-14-tripadvisor-live-venues-design.md`

## Global Constraints

- **TripAdvisor API key is server-only.** It is IP-restricted; it must never reach the browser. Read it as `TRIPADVISOR_API_KEY` from `.env.local`, never `NEXT_PUBLIC_*`.
- **Base URL:** `https://api.content.tripadvisor.com/api/v1`. The key is a **query parameter** (`?key=...`), not a `Bearer` header.
- **Call budget:** 5,000/month free. Every TripAdvisor `fetch` must set `next: { revalidate: 86400 }`.
- **Result cap:** 20 venues displayed, always with the total found stated alongside.
- **Attribution is mandatory** on any surface showing TripAdvisor content: their `rating_image_url` bubble image (never our own star icons as the primary rating), a TripAdvisor logo ≥20px high, and a link to `ta_url`.
- **Extracted capacity never earns `verified`.** Curated → `verified`; extracted with a number → `likely`; extracted names only → `unverified`; nothing found → `unverified`.
- **"Book" never books.** No code path may contact a venue or create a real reservation.
- **Extraction model:** `claude-opus-5`. Do not substitute a cheaper model.
- **Scripts live in `scripts/`.** One-off data scripts are `.mjs` run with `node`, matching the existing `generate-seed.mjs`. The extractor is the exception: it is `.ts` run with `tsx`, so it imports the tested guard from `src/lib/` rather than duplicating it.
- The key currently returns `403`. Add `108.60.118.202` to the TripAdvisor key's IPv4 allowlist before running anything that calls the API. Tasks 1–3, 5, 9, 10, 13, 14 need no network.

---

### Task 1: Test harness and price-level parsing

Establishes Vitest and delivers the first pure function. `price_level` arrives from TripAdvisor as a display string like `"$$ - $$$"`; the app stores a 1–4 integer.

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/tripadvisor-parse.ts`
- Create: `src/lib/tripadvisor-parse.test.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Consumes: nothing
- Produces: `parsePriceLevel(raw: string | null | undefined): number | null` — returns the **upper** bound of the range, clamped 1–4, or `null` when unparseable.

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest@^3 vite-tsconfig-paths@^5
```

- [ ] **Step 2: Create `vitest.config.ts`**

The `@/` alias in `tsconfig.json` must resolve in tests, hence `vite-tsconfig-paths`.

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script to `package.json`**

Add to the `"scripts"` object:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test**

Create `src/lib/tripadvisor-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePriceLevel } from "./tripadvisor-parse";

describe("parsePriceLevel", () => {
  it("takes the upper bound of a range", () => {
    expect(parsePriceLevel("$$ - $$$")).toBe(3);
  });

  it("handles a single tier", () => {
    expect(parsePriceLevel("$$")).toBe(2);
  });

  it("clamps above four", () => {
    expect(parsePriceLevel("$$$$$$")).toBe(4);
  });

  it("returns null for null, undefined, and empty", () => {
    expect(parsePriceLevel(null)).toBeNull();
    expect(parsePriceLevel(undefined)).toBeNull();
    expect(parsePriceLevel("")).toBeNull();
  });

  it("returns null when there is no dollar sign", () => {
    expect(parsePriceLevel("moderate")).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./tripadvisor-parse`.

- [ ] **Step 6: Write the implementation**

Create `src/lib/tripadvisor-parse.ts`:

```ts
/**
 * TripAdvisor returns price_level as a display string ("$$ - $$$").
 * The app stores a 1-4 integer tier; we take the upper bound so a venue is
 * never ranked cheaper than it might actually be.
 */
export function parsePriceLevel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const runs = raw.match(/\$+/g);
  if (!runs) return null;
  const widest = Math.max(...runs.map((r) => r.length));
  return Math.min(4, Math.max(1, widest));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 5 tests.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/tripadvisor-parse.ts src/lib/tripadvisor-parse.test.ts
git commit -m "test: add vitest harness and TripAdvisor price-level parsing"
```

---

### Task 2: Nullable room capacities and ranking

An extracted room may be named without a stated capacity. `Room.seated`/`Room.standing` become nullable, and ranking must treat "unknown" as *unconfirmed* rather than *zero* — a venue whose only rooms lack numbers plausibly fits and should not be buried below one that genuinely holds 4 people.

**Files:**
- Modify: `src/lib/types.ts:10-15` (Room), `:23-47` (Venue)
- Modify: `src/lib/ranking.ts:37-57` (`relevantCapacity`, `pickBestRoom`), `:107-124` (capacity factor)
- Create: `src/lib/ranking.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Room.seated: number | null`, `Room.standing: number | null`
  - `Venue.ta_location_id: string | null`, `Venue.ta_url: string | null`, `Venue.ta_rating_image_url: string | null`, `Venue.capacity_source_url: string | null`
  - `relevantCapacity(room: Room, style: EventStyle): number | null`
  - `pickBestRoom(venue: Venue, headcount: number, style: EventStyle): Room | null` — prefers the smallest room that fits; falls back to the largest **known** room; returns an unknown-capacity room only when no room has a number.

- [ ] **Step 1: Widen the `Room` and `Venue` types**

In `src/lib/types.ts`, replace the `Room` interface:

```ts
export interface Room {
  name: string;
  /** null when the source named the room but stated no capacity. */
  seated: number | null;
  standing: number | null;
  notes: string | null;
}
```

Delete `min_spend` and `price_trust` from `Venue`. The price signal is now
TripAdvisor's `price_level` tier alone, so a per-venue price-trust label would
carry the same value on every card, and a curated or extracted minimum spend no
longer feeds anything.

Then add four fields to `Venue`, after `rooms: Room[];`:

```ts
  /** TripAdvisor location id — the join key for overlay and capacity data. */
  ta_location_id: string | null;
  /** TripAdvisor listing URL — required by their display terms. */
  ta_url: string | null;
  /** TripAdvisor-hosted bubble rating image; must be used over our own stars. */
  ta_rating_image_url: string | null;
  /** Page the room capacities were extracted from, when machine-extracted. */
  capacity_source_url: string | null;
```

- [ ] **Step 2: Write the failing ranking tests**

Create `src/lib/ranking.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- ranking`
Expected: FAIL — TypeScript errors on nullable arithmetic, and the unknown-capacity assertions do not hold.

- [ ] **Step 4: Update `relevantCapacity` and `pickBestRoom`**

In `src/lib/ranking.ts`, replace both functions (currently lines 37-57):

```ts
function relevantCapacity(room: Room, style: "seated" | "reception"): number | null {
  const values =
    style === "reception" ? [room.standing, room.seated] : [room.seated];
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * The smallest room that still fits the group; else the largest room whose
 * capacity we know; else an unknown-capacity room, which ranks as
 * "unconfirmed" rather than "too small".
 */
function pickBestRoom(
  venue: Venue,
  headcount: number,
  style: "seated" | "reception"
): Room | null {
  if (venue.rooms.length === 0) return null;
  const known = venue.rooms
    .map((r) => ({ room: r, cap: relevantCapacity(r, style) }))
    .filter((x): x is { room: Room; cap: number } => x.cap !== null);
  if (known.length === 0) return venue.rooms[0];
  const fitting = known
    .filter((x) => x.cap >= headcount)
    .sort((a, b) => a.cap - b.cap);
  if (fitting.length > 0) return fitting[0].room;
  return known.reduce((max, x) => (x.cap > max.cap ? x : max)).room;
}
```

- [ ] **Step 5: Update the capacity factor**

In `src/lib/ranking.ts`, replace the capacity block (currently lines 107-124):

```ts
    const bestRoom = pickBestRoom(venue, params.headcount, params.eventStyle);
    // `null`, not 0, when there is no room: a venue with no room data is
    // UNKNOWN, not known-to-hold-nobody. Using 0 here makes capacityKnown
    // always true and scores every live TripAdvisor venue (which all arrive
    // with rooms: []) at capacity zero.
    const bestCapacity = bestRoom
      ? relevantCapacity(bestRoom, params.eventStyle)
      : null;
    const capacityKnown = bestCapacity !== null;
    const capacityOk = capacityKnown && bestCapacity >= params.headcount;
    // Unknown capacity scores as unconfirmed, not as zero: the room may well
    // fit, and burying it under a venue that genuinely holds 4 people is wrong.
    const capacityScore = !capacityKnown
      ? 0.5
      : capacityOk
        ? 0.6 + 0.4 * (params.headcount / bestCapacity)
        : 0.5 * (bestCapacity / params.headcount);
    factors.push({
      key: "capacity",
      label: "Capacity",
      score: capacityScore,
      weight: WEIGHTS.capacity,
      detail: !capacityKnown
        ? bestRoom
          ? `${bestRoom.name} — capacity unconfirmed`
          : "No capacity data"
        : capacityOk
          ? `${bestRoom?.name ?? "Room"} fits ${params.headcount} (max ${bestCapacity})`
          : `Largest space holds ${bestCapacity} of ${params.headcount}`,
    });
```

- [ ] **Step 6: Rewrite the price factor around TripAdvisor's tier**

In `src/lib/ranking.ts`, replace the price block (currently lines 151-161):

```ts
    // Price is TripAdvisor's own $-tier. Known beats unknown; nothing else to
    // weigh, since every venue's price comes from the same source.
    const priceKnown = venue.price_tier !== null;
    factors.push({
      key: "price",
      label: "Price signal",
      score: priceKnown ? 1 : 0.5,
      weight: WEIGHTS.price,
      detail: priceKnown
        ? `${"$".repeat(venue.price_tier!)} on Tripadvisor`
        : "No price data",
    });
```

Then update `PriceSignal` in `src/components/Badges.tsx` (lines 36-48), which
still reads `min_spend` and `price_trust`:

```tsx
export function PriceSignal({ venue }: { venue: Venue }) {
  const tier = venue.price_tier ? PRICE_TIER_LABELS[venue.price_tier] : null;
  return (
    <span
      className="font-data text-[13px] font-semibold text-ink"
      title="Price level reported by Tripadvisor"
    >
      {tier ?? "Price unknown"}
    </span>
  );
}
```

`TRUST_SCORE` is still used by the `trust` factor — leave it in place.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 9 tests across both files.

- [ ] **Step 8: Verify the app still type-checks**

Run: `npm run build`
Expected: errors wherever `min_spend`, `price_trust`, or a non-null `Room.seated` was assumed — `src/lib/venues.ts` (the `rowToVenue` mapper) and `src/components/Badges.tsx` are the likely sites. Fix each by dropping the removed field or handling `null`. `scripts/generate-seed.mjs` is plain JS and is not type-checked; it is removed in Task 9.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/ranking.ts src/lib/ranking.test.ts src/components/Badges.tsx src/lib/venues.ts
git commit -m "feat: nullable room capacities, TripAdvisor tier as the price signal"
```

---

### Task 3: Search grid geometry

TripAdvisor returns at most 10 results per search with no pagination, so one call cannot fill a map. This produces the set of points to search.

**Files:**
- Create: `src/lib/search-grid.ts`
- Create: `src/lib/search-grid.test.ts`

**Interfaces:**
- Consumes: `SEARCH_RADIUS_MILES` from `src/lib/geo.ts`
- Produces:
  - `commuteRadiusKm(maxCommuteMinutes: number, mode: CommuteMode): number` — inverts `commuteMinutes()`, clamped to the 20-mile hard limit.
  - `searchGrid(lat: number, lng: number, radiusKm: number): { lat: number; lng: number }[]` — centre plus two rings of 6 (at 0.5 and 0.85 × radius, the outer offset half a step), 13 total. The pool must be large enough that 20 venues survive dedup, the radius filter, and the commute limit.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/search-grid.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- search-grid`
Expected: FAIL — cannot resolve `./search-grid`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/search-grid.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all files green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/search-grid.ts src/lib/search-grid.test.ts
git commit -m "feat: add commute-radius and search-grid geometry"
```

---

### Task 4: TripAdvisor API client

**Files:**
- Create: `src/lib/tripadvisor.ts`
- Modify: `.env` (declare `TRIPADVISOR_API_KEY`, empty)

**Interfaces:**
- Consumes: `parsePriceLevel` (Task 1)
- Produces:
  - `type TaSearchHit = { location_id: string; name: string; distanceKm: number | null }`
  - `type TaDetails = { location_id: string; name: string; address: string; city: string; lat: number; lng: number; cuisine: string; rating: number | null; review_count: number | null; price_tier: number | null; phone: string | null; website: string | null; ta_url: string | null; ta_rating_image_url: string | null }`
  - `class TripAdvisorError extends Error { status: number }`
  - `nearbySearch(lat: number, lng: number, radiusKm: number): Promise<TaSearchHit[]>`
  - `locationDetails(locationId: string): Promise<TaDetails | null>`

- [ ] **Step 1: Declare the key in the committed `.env`**

There is no `.env.example` in this repo and one should not be created: the project already
commits a `.env` carrying browser-safe defaults, and documents `.env.local` overrides in the
README. A third place to describe environment variables would drift. Append to `.env`:

```
# TripAdvisor Content API — https://www.tripadvisor.com/developers
# Free tier: 5,000 calls/month. A credit card is required at signup, and the key
# is not issued until you restrict it to an IPv4 address or domain.
# Server-only — never expose this as NEXT_PUBLIC_*. Set the real value in
# .env.local, which is gitignored and overrides this file.
TRIPADVISOR_API_KEY=
```

Leave the value empty here. The real key belongs in `.env.local`.

- [ ] **Step 2: Write the client**

Create `src/lib/tripadvisor.ts`:

```ts
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
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Smoke-test against the live API**

Requires `TRIPADVISOR_API_KEY` in `.env.local` and this machine's IP on the allowlist.

```bash
curl -s -w "\nHTTP:%{http_code}\n" \
  "https://api.content.tripadvisor.com/api/v1/location/nearby_search?latLong=40.7580,-73.9855&category=restaurants&radius=1&radiusUnit=km&key=$(grep TRIPADVISOR_API_KEY .env.local | cut -d= -f2)"
```

Expected: `HTTP:200` and a `data` array of up to 10 restaurants. **If this returns 403, stop and fix the IP allowlist** — Tasks 4, 7, 11, 12 cannot be verified until it passes. Record the outcome; do not claim the client works on a 403.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tripadvisor.ts .env
git commit -m "feat: add TripAdvisor Content API client"
```

---

### Task 5: Venue merge

Combines a live TripAdvisor record with the curated overlay and the extracted-capacity cache into the `Venue` the rest of the app already consumes.

**Files:**
- Create: `src/lib/merge-venue.ts`
- Create: `src/lib/merge-venue.test.ts`

**Interfaces:**
- Consumes: `TaDetails` (Task 4), `Venue`/`Room` (Task 2)
- Produces:
  - `interface OverlayEntry { ta_location_id: string | null; id: string; name: string; address: string; lat: number; lng: number; city: string; neighbourhood: string | null; region: string; description: string | null; dietary: string[]; event_styles: EventStyle[]; menu_image_url: string | null; menu_highlights: MenuItem[]; contact: Contact; rooms: Room[] }` — `name`/`address`/`lat`/`lng`/`city` are **display fallbacks only**, used when TripAdvisor is unreachable; the live record always wins. `neighbourhood` disambiguates branches of a chain for the Task 10 guard.
  - `interface CapacityEntry { ta_location_id: string; rooms: Room[]; source_url: string | null; confidence: "likely" | "unverified" }`
  - `mergeVenue(live: TaDetails, overlay: OverlayEntry | undefined, capacity: CapacityEntry | undefined): Venue`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/merge-venue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeVenue, type CapacityEntry, type OverlayEntry } from "./merge-venue";
import type { TaDetails } from "./tripadvisor";

const live: TaDetails = {
  location_id: "123", name: "Carmine's", address: "200 W 44th St, New York, NY",
  city: "New York", lat: 40.7576, lng: -73.987, cuisine: "Italian",
  rating: 4.2, review_count: 5182, price_tier: 2, phone: "(212) 221-3800",
  website: "https://www.carminesnyc.com/", ta_url: "https://tripadvisor.com/x",
  ta_rating_image_url: "https://tripadvisor.com/bubbles.png",
};

const overlay: OverlayEntry = {
  ta_location_id: "123", id: "carmines-times-square",
  name: "Carmine's Italian Restaurant",
  address: "200 W 44th St, New York, NY 10036",
  lat: 40.7576, lng: -73.987, city: "New York",
  neighbourhood: "Times Square", region: "nyc",
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- merge-venue`
Expected: FAIL — cannot resolve `./merge-venue`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/merge-venue.ts`:

```ts
import type { TaDetails } from "./tripadvisor";
import type {
  Contact, EventStyle, MenuItem, Room, TrustLabel, Venue,
} from "./types";

/** Curated private-dining data — only what TripAdvisor cannot supply. */
export interface OverlayEntry {
  ta_location_id: string | null;
  id: string;
  /**
   * Display fallbacks, used only when TripAdvisor is unreachable. The live
   * record always wins in mergeVenue; these exist so the demo scenarios still
   * render something when the API is down or the key's IP allowlist is stale.
   */
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string;
  /** Disambiguates branches of a chain for the extraction guard (Task 10). */
  neighbourhood: string | null;
  region: string;
  description: string | null;
  dietary: string[];
  event_styles: EventStyle[];
  menu_image_url: string | null;
  menu_highlights: MenuItem[];
  contact: Contact;
  rooms: Room[];
}

/** Machine-extracted capacity from the restaurant's own website. */
export interface CapacityEntry {
  ta_location_id: string;
  rooms: Room[];
  source_url: string | null;
  confidence: "likely" | "unverified";
}

/**
 * Precedence: live TripAdvisor owns the public signals; the curated overlay
 * owns private-dining fields and outranks extraction entirely; extraction
 * fills in only where no overlay entry exists. A venue with neither is
 * honestly labelled "needs a call".
 */
export function mergeVenue(
  live: TaDetails,
  overlay: OverlayEntry | undefined,
  capacity: CapacityEntry | undefined
): Venue {
  const useCapacity = !overlay && capacity !== undefined;

  const rooms = overlay?.rooms ?? (useCapacity ? capacity.rooms : []);
  const trust_label: TrustLabel = overlay
    ? "verified"
    : useCapacity
      ? capacity.confidence
      : "unverified";

  return {
    id: overlay?.id ?? `ta-${live.location_id}`,
    name: live.name,
    address: live.address,
    city: live.city,
    region: overlay?.region ?? live.city.toLowerCase().replace(/\s+/g, "-"),
    lat: live.lat,
    lng: live.lng,
    cuisine: live.cuisine,
    description: overlay?.description ?? null,
    rating: live.rating,
    review_count: live.review_count,
    price_tier: live.price_tier,
    trust_label,
    dietary: overlay?.dietary ?? [],
    event_styles: overlay?.event_styles ?? ["seated", "reception"],
    image_url: null,
    menu_url: live.website,
    menu_image_url: overlay?.menu_image_url ?? null,
    menu_highlights: overlay?.menu_highlights ?? [],
    contact: {
      name: overlay?.contact.name ?? null,
      email: overlay?.contact.email ?? null,
      phone: overlay?.contact.phone ?? live.phone,
    },
    rooms,
    ta_location_id: live.location_id,
    ta_url: live.ta_url,
    ta_rating_image_url: live.ta_rating_image_url,
    capacity_source_url: useCapacity ? capacity.source_url : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 merge tests plus the earlier files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/merge-venue.ts src/lib/merge-venue.test.ts
git commit -m "feat: merge live TripAdvisor data with curated and extracted capacity"
```

---

### Task 6: Live search route

**Files:**
- Create: `src/app/api/venues/search/route.ts`
- Create: `src/lib/overlay.ts`
- Create: `src/data/overlay.json` (empty array for now; populated in Task 7)

**Interfaces:**
- Consumes: `searchGrid`, `commuteRadiusKm` (Task 3); `nearbySearch`, `locationDetails`, `TripAdvisorError` (Task 4); `mergeVenue`, `OverlayEntry` (Task 5)
- Produces:
  - `GET /api/venues/search?lat&lng&minutes&mode` → `{ venues: Venue[], source: "live" | "overlay", notice: string | null }`
  - `loadOverlay(): OverlayEntry[]` and `overlayByLocationId(): Map<string, OverlayEntry>` from `src/lib/overlay.ts`

- [ ] **Step 1: Create the empty overlay and its loader**

Create `src/data/overlay.json`:

```json
[]
```

Create `src/lib/overlay.ts`:

```ts
import raw from "@/data/overlay.json";
import type { OverlayEntry } from "./merge-venue";

export function loadOverlay(): OverlayEntry[] {
  return raw as unknown as OverlayEntry[];
}

/** Only entries with a confirmed TripAdvisor match are addressable. */
export function overlayByLocationId(): Map<string, OverlayEntry> {
  const map = new Map<string, OverlayEntry>();
  for (const entry of loadOverlay()) {
    if (entry.ta_location_id) map.set(entry.ta_location_id, entry);
  }
  return map;
}
```

- [ ] **Step 2: Write the route**

Create `src/app/api/venues/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { commuteRadiusKm, searchGrid } from "@/lib/search-grid";
import { haversineKm } from "@/lib/geo";
import { mergeVenue } from "@/lib/merge-venue";
import { overlayByLocationId } from "@/lib/overlay";
import {
  locationDetails, nearbySearch, TripAdvisorError, type TaDetails,
} from "@/lib/tripadvisor";
import type { CommuteMode, Venue } from "@/lib/types";

/**
 * Details calls dominate the budget. 45 candidates is sized so that 20 still
 * survive dedup, the radius filter, and the commute limit — the user's
 * requirement is 20 results for any address, not 20 candidates.
 */
const MAX_CANDIDATES = 45;

export async function GET(request: Request) {
  const url = new URL(request.url);
  // searchParams.get returns null for an absent param, and Number(null) is 0 —
  // which is finite, so a request with no query string at all would otherwise
  // validate as lat=0, lng=0, minutes=0 and search the Gulf of Guinea.
  const num = (key: string): number => {
    const raw = url.searchParams.get(key);
    return raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  };
  const lat = num("lat");
  const lng = num("lng");
  const minutes = num("minutes");
  const mode = (url.searchParams.get("mode") ?? "walking") as CommuteMode;

  // |lat| > 89.9 is rejected here because searchGrid's longitude scaling
  // divides by cos(lat), which is zero at the poles.
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(minutes) ||
    Math.abs(lat) > 89.9 ||
    minutes <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "lat, lng and minutes are required; lat must be a real latitude and minutes positive",
      },
      { status: 400 }
    );
  }

  const radiusKm = commuteRadiusKm(minutes, mode);
  const overlay = overlayByLocationId();

  // Curated venues inside the radius are always included: with only 10 results
  // per search point, TripAdvisor will otherwise drop the venues that carry
  // the capacity data the ranker depends on.
  const overlayIds = [...overlay.entries()]
    .filter(([, e]) => haversineKm(lat, lng, e.lat, e.lng) <= radiusKm)
    .map(([id]) => id);

  try {
    const grid = searchGrid(lat, lng, radiusKm);
    const settled = await Promise.all(
      grid.map((p) =>
        nearbySearch(p.lat, p.lng, radiusKm).then(
          (hits) => ({ ok: true as const, hits }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    );
    const hits = settled.flatMap((r) => (r.ok ? r.hits : []));
    // One flaky grid point is tolerable. Every point failing is systemic — a
    // bad key, an IP not on the allowlist, exhausted quota — and must surface
    // as the overlay fallback with its notice, not as a silent "0 venues".
    // Catching each point to [] unconditionally makes the whole failure-mode
    // design in spec §12 unreachable.
    const failure = settled.find((r) => !r.ok);
    if (hits.length === 0 && failure && !failure.ok) {
      throw failure.error;
    }

    const byId = new Map<string, number>();
    for (const hit of hits) {
      const d = hit.distanceKm ?? Number.POSITIVE_INFINITY;
      if (!byId.has(hit.location_id) || d < byId.get(hit.location_id)!) {
        byId.set(hit.location_id, d);
      }
    }
    for (const id of overlayIds) if (!byId.has(id)) byId.set(id, 0);

    const candidates = [...byId.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, MAX_CANDIDATES)
      .map(([id]) => id);

    const details = (await Promise.all(
      candidates.map((id) => locationDetails(id).catch(() => null))
    )).filter((d): d is TaDetails => d !== null);

    const venues: Venue[] = details
      .filter((d) => haversineKm(lat, lng, d.lat, d.lng) <= radiusKm)
      .map((d) => mergeVenue(d, overlay.get(d.location_id), undefined));

    return NextResponse.json({ venues, source: "live", notice: null });
  } catch (error) {
    const notice =
      error instanceof TripAdvisorError
        ? error.status === 403
          ? "TripAdvisor key not authorized — check the IP allowlist."
          : error.status === 429
            ? "TripAdvisor rate limit reached — showing curated venues only."
            : "Live data unavailable — showing curated venues only."
        : "Live data unavailable — showing curated venues only.";
    return NextResponse.json({ venues: [], source: "overlay", notice });
  }
}
```

- [ ] **Step 3: Verify it compiles and the route responds**

```bash
npx tsc --noEmit
npm run dev
```

Then in another shell:

```bash
curl -s "http://localhost:3000/api/venues/search?lat=40.7580&lng=-73.9855&minutes=20&mode=walking" | head -c 400
```

Expected with a working key: `{"venues":[...],"source":"live","notice":null}`.
Expected with the 403 still in place: `{"venues":[],"source":"overlay","notice":"TripAdvisor key not authorized — check the IP allowlist."}` — which is the correct, designed behavior. Record which one you got.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/venues/search/route.ts src/lib/overlay.ts src/data/overlay.json
git commit -m "feat: add live TripAdvisor venue search route"
```

---

### Task 7: Build the curated overlay

Converts the 38 hand-curated venues into an overlay keyed by TripAdvisor `location_id`, keeping only the fields TripAdvisor cannot supply.

**Files:**
- Create: `scripts/match-overlay.mjs`
- Modify: `src/data/overlay.json` (generated, then hand-reviewed)
- Delete: `scripts/enrich-yelp.mjs`

**Interfaces:**
- Consumes: the live TripAdvisor search API
- Produces: a populated `src/data/overlay.json` conforming to `OverlayEntry[]`

- [ ] **Step 1: Write the match script**

Create `scripts/match-overlay.mjs`:

```js
// Builds src/data/overlay.json from the legacy src/data/venues.json by matching
// each curated venue to a TripAdvisor location_id, keeping ONLY the fields
// TripAdvisor cannot supply (rooms, contact, dietary, menu notes).
//
// Matches are written with a _match_candidate field for human review. An entry
// whose match you have not confirmed keeps ta_location_id: null and is ignored
// at runtime.
//
// Usage:
//   1. TRIPADVISOR_API_KEY=... in .env.local, with this machine's IP allowlisted
//   2. node scripts/match-overlay.mjs
//   3. Review each _match_candidate; delete the field once confirmed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadKey() {
  if (process.env.TRIPADVISOR_API_KEY) return process.env.TRIPADVISOR_API_KEY;
  const envPath = join(root, ".env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^TRIPADVISOR_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

// The transform half reads local JSON and needs no API. Only the MATCHING
// half needs a key, so a missing key must not stop the script — otherwise the
// checked-in overlay.json cannot be regenerated from committed code.
const KEY = loadKey();
if (!KEY) {
  console.warn(
    "No TRIPADVISOR_API_KEY found — transforming src/data/venues.json only.\n" +
      "Every entry will be written with ta_location_id: null and no _match_candidate.\n" +
      "Get a key at https://www.tripadvisor.com/developers, restrict it to this\n" +
      "machine's public IPv4, put it in .env.local, and re-run to populate matches.\n"
  );
}

const venues = JSON.parse(
  readFileSync(join(root, "src", "data", "venues.json"), "utf8")
);

async function search(name, lat, lng) {
  const url = new URL("https://api.content.tripadvisor.com/api/v1/location/search");
  url.searchParams.set("searchQuery", name);
  url.searchParams.set("category", "restaurants");
  url.searchParams.set("latLong", `${lat},${lng}`);
  url.searchParams.set("radius", "2");
  url.searchParams.set("radiusUnit", "km");
  url.searchParams.set("key", KEY);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 403) {
    console.error(
      "403 from TripAdvisor — add this machine's public IPv4 to the key's allowlist."
    );
    process.exit(1);
  }
  if (!res.ok) throw new Error(`search ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data?.[0] ?? null;
}

const overlay = [];
let matched = 0;

for (const v of venues) {
  let hit = null;
  if (KEY) {
    try {
      hit = await search(v.name, v.lat, v.lng);
    } catch (e) {
      console.warn(`  error for ${v.name}: ${e.message}`);
    }
    if (hit) {
      matched++;
      console.log(`  ✓ ${v.name} → ${hit.name} (${hit.location_id})`);
    } else {
      console.warn(`  no match: ${v.name}`);
    }
  }

  overlay.push({
    // Unconfirmed until a human deletes _match_candidate.
    ta_location_id: null,
    ...(hit
      ? { _match_candidate: { location_id: String(hit.location_id), name: hit.name } }
      : {}),
    id: v.id,
    // Display fallbacks for when TripAdvisor is unreachable.
    name: v.name,
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    city: v.city,
    // Set by hand during review; disambiguates branches of a chain.
    neighbourhood: null,
    region: v.region,
    description: v.description,
    dietary: v.dietary,
    event_styles: v.event_styles,
    menu_image_url: v.menu_image_url,
    menu_highlights: v.menu_highlights,
    contact: v.contact,
    rooms: v.rooms.map((r) => ({
      name: r.name,
      seated: r.seated ?? null,
      standing: r.standing ?? null,
      notes: r.notes ?? null,
    })),
  });

  // Nothing to rate-limit when no requests are being made.
  if (KEY) await new Promise((r) => setTimeout(r, 250));
}

writeFileSync(
  join(root, "src", "data", "overlay.json"),
  JSON.stringify(overlay, null, 2) + "\n"
);
console.log(
  KEY
    ? `\nWrote overlay.json — ${matched}/${venues.length} matched. ` +
        `Review each _match_candidate, then set ta_location_id and delete the field.`
    : `\nWrote overlay.json — ${venues.length} entries, 0 matched (no API key). ` +
        `Re-run with a key to populate match candidates.`
);
```

- [ ] **Step 2: Run it**

Run: `node scripts/match-overlay.mjs`
Expected: 38 lines of `✓` or `no match`, then `Wrote overlay.json`. If it exits on 403, fix the IP allowlist first.

- [ ] **Step 3: Review the matches by hand**

Open `src/data/overlay.json`. For each entry, confirm `_match_candidate.name` is the same restaurant at the same location — TripAdvisor will happily return a different branch of a chain. For each confirmed one, copy the candidate's `location_id` into `ta_location_id` and delete `_match_candidate`. Leave unconfirmed entries with `ta_location_id: null`; they are skipped at runtime rather than mismatched.

While you are in the file, set `neighbourhood` for any venue that belongs to a multi-location group — `"Times Square"` for Carmine's, for example. Task 10's guard uses it to tell one branch's private rooms from another's. Leave it `null` for independents.

- [ ] **Step 4: Verify the overlay loads and merges**

Run: `curl -s "http://localhost:3000/api/venues/search?lat=40.7580&lng=-73.9855&minutes=20&mode=walking" | grep -o '"trust_label":"verified"' | wc -l`
Expected: at least 1, assuming at least one NYC venue was confirmed.

- [ ] **Step 5: Delete the Yelp script**

```bash
git rm scripts/enrich-yelp.mjs
```

- [ ] **Step 6: Commit**

```bash
git add scripts/match-overlay.mjs src/data/overlay.json
git commit -m "feat: build curated private-dining overlay keyed by TripAdvisor id"
```

---

### Task 8: Point the UI at the live route

**Files:**
- Modify: `src/app/page.tsx:10` (imports), `:22-45` (state and effects), `:47-81` (search)
- Modify: `src/lib/venues.ts` (replace catalog loading with overlay-derived fallback)

**Interfaces:**
- Consumes: `GET /api/venues/search` (Task 6), `loadOverlay` (Task 6)
- Produces: `FALLBACK_VENUES: Venue[]` from `src/lib/venues.ts` — overlay entries rendered as venues with no live signals, for use when TripAdvisor is unreachable.

- [ ] **Step 1: Replace `src/lib/venues.ts`**

The catalog tables are gone in Task 9, so this file stops talking to Supabase entirely. Overwrite it:

```ts
import { loadOverlay } from "./overlay";
import type { Venue } from "./types";

/**
 * Curated venues rendered without live signals. Serves the three demo
 * scenarios when TripAdvisor is unreachable, out of quota, or the key's IP
 * allowlist does not cover this host.
 */
export const FALLBACK_VENUES: Venue[] = loadOverlay()
  .filter((e) => e.ta_location_id !== null)
  .map((e) => ({
    id: e.id,
    name: e.name,
    address: e.address,
    city: e.city,
    region: e.region,
    lat: e.lat,
    lng: e.lng,
    cuisine: "Restaurant",
    description: e.description,
    rating: null,
    review_count: null,
    price_tier: null,
    trust_label: "verified",
    dietary: e.dietary,
    event_styles: e.event_styles,
    image_url: null,
    menu_url: null,
    menu_image_url: e.menu_image_url,
    menu_highlights: e.menu_highlights,
    contact: e.contact,
    rooms: e.rooms,
    ta_url: null,
    ta_rating_image_url: null,
    capacity_source_url: null,
  }));
```

Note: the overlay deliberately does not store name, address, or coordinates — those are TripAdvisor's. The fallback therefore renders a degraded card. Task 9's follow-up is to add `name`, `address`, `lat`, `lng` to each overlay entry as a **display fallback only**; do that now while reviewing the overlay, copying the values from `venues.json` before it is deleted.

- [ ] **Step 2: Verify the overlay's display-fallback fields (already present)**

This step is a check, not a change. `OverlayEntry` was defined complete in Task 5 — including
`name`, `address`, `lat`, `lng`, `city`, and `neighbourhood` — and Task 7 populated all of them
for the 38 curated venues. Confirm and move on:

```bash
node -e "const o=require('./src/data/overlay.json');const bad=o.filter(e=>!e.name||!e.address||typeof e.lat!=='number'||typeof e.lng!=='number');console.log(o.length+' entries, '+bad.length+' missing display fallbacks')"
```

Expected: `38 entries, 0 missing display fallbacks`.

Do **not** add these fields to `OverlayEntry` — they are already there, and a duplicate member
is a TypeScript error. Do not change `mergeVenue`: it deliberately prefers `live.name` /
`live.address` / `live.lat` / `live.lng` over the overlay's copies, which exist only for the
offline path this task builds.

- [ ] **Step 3: Rewrite the search handler in `page.tsx`**

Replace the import on line 10:

```ts
import { FALLBACK_VENUES } from "@/lib/venues";
```

Replace the venue state and the mount effect (lines 23-40) with:

```ts
  const [venues, setVenues] = useState<Venue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
```

Delete the `dataSource` state and the `useEffect` that called `loadVenues()`. Then in `search`, after `setParams(p)` (line 72), replace `setRanked(rankVenues(venues, p))` with:

```ts
      const vres = await fetch(
        `/api/venues/search?lat=${p.lat}&lng=${p.lng}` +
          `&minutes=${p.maxCommuteMinutes}&mode=${p.commuteMode}`
      );
      const payload = (await vres.json()) as {
        venues: Venue[];
        notice: string | null;
      };
      const found = payload.venues.length > 0 ? payload.venues : FALLBACK_VENUES;
      setVenues(found);
      setNotice(payload.notice);
      setRanked(rankVenues(found, p));
```

- [ ] **Step 4: Fix the cuisine dropdown**

`cuisines` (line 42-45) derives from `venues`, which is now empty before the first search. Seed it from the overlay so the filter is usable immediately:

```ts
  const cuisines = useMemo(() => {
    const live = venues.map((v) => v.cuisine);
    return [...new Set(live.length > 0 ? live : ["Italian", "American", "Japanese"])].sort();
  }, [venues]);
```

- [ ] **Step 5: Render the notice**

Replace whatever renders the "database offline" chip with the live notice. Insert above the results heading (near line 143):

```tsx
              {notice && (
                <p className="mb-2 rounded bg-claret-soft px-2 py-1 text-[12px] text-claret">
                  {notice}
                </p>
              )}
```

- [ ] **Step 6: Verify end to end**

```bash
npm run build && npm run dev
```

Open http://localhost:3000, run the "50 people near Times Square" scenario, and confirm results render. With a working key they come from TripAdvisor; with the 403 in place you get `FALLBACK_VENUES` plus the allowlist notice. Both are acceptable outcomes for this task — state which you saw.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/lib/venues.ts src/lib/merge-venue.ts src/data/overlay.json
git commit -m "feat: search live TripAdvisor venues from the UI"
```

---

### Task 9: Drop the catalog tables and snapshot reservations

**Files:**
- Create: `supabase/migrations/0003_live_venues.sql`
- Modify: `src/lib/reservations.ts:11-19` (`NewReservation`), `:109-131` (`listReservations`)
- Modify: `src/lib/types.ts` (`Reservation`)
- Modify: `src/components/ReservationModal.tsx:91` (the `createReservation` call)
- Delete: `scripts/generate-seed.mjs`, `supabase/migrations/0002_seed.sql`, `src/data/venues.json`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_live_venues.sql`:

```sql
-- Venues are now fetched live from TripAdvisor per search. The catalog tables
-- go away; reservations keep a self-contained snapshot of the chosen venue so
-- saved plans survive a delisting or an API outage.

alter table public.reservations
  add column if not exists venue_name text,
  add column if not exists venue_address text,
  add column if not exists venue_lat double precision,
  add column if not exists venue_lng double precision,
  add column if not exists venue_ta_id text,
  add column if not exists venue_ta_url text,
  add column if not exists venue_rating numeric(2, 1),
  add column if not exists venue_image_url text;

-- Backfill from the catalog BEFORE dropping it, so existing plans keep working.
update public.reservations r
set venue_name = v.name,
    venue_address = v.address,
    venue_lat = v.lat,
    venue_lng = v.lng,
    venue_rating = v.rating,
    venue_image_url = v.image_url
from public.venues v
where v.id = r.venue_id and r.venue_name is null;

alter table public.reservations
  drop constraint if exists reservations_venue_id_fkey;

drop index if exists reservations_venue_id_idx;
drop table if exists public.private_rooms;
drop table if exists public.venues;

-- Machine-extracted private-dining data. Not a venue catalog: no names,
-- addresses, ratings or listing links — only what TripAdvisor cannot supply.
create table if not exists public.venue_capacity (
  ta_location_id text primary key,
  rooms jsonb not null default '[]',
  source_url text,
  confidence text not null default 'unverified'
    check (confidence in ('likely', 'unverified')),
  extracted_at timestamptz not null default now()
);

alter table public.venue_capacity enable row level security;

drop policy if exists "venue_capacity readable" on public.venue_capacity;
create policy "venue_capacity readable" on public.venue_capacity
  for select to anon, authenticated using (true);
-- Writes are service-role only: the extractor is the sole writer.
```

- [ ] **Step 2: Update the reservation types**

In `src/lib/types.ts`, replace `venue_id: string;` in `Reservation` with:

```ts
  venue_id: string;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  venue_ta_id: string | null;
  venue_ta_url: string | null;
  venue_rating: number | null;
  venue_image_url: string | null;
```

- [ ] **Step 3: Update `NewReservation` and `listReservations`**

In `src/lib/reservations.ts`, add the snapshot fields to `NewReservation` after `venue_id: string;`:

```ts
  venue_name: string;
  venue_address: string;
  venue_lat: number;
  venue_lng: number;
  venue_ta_id: string | null;
  venue_ta_url: string | null;
  venue_rating: number | null;
  venue_image_url: string | null;
```

Then replace `listReservations` (lines 109-131), which currently joins `venues`:

```ts
export async function listReservations(): Promise<ReservationWithDetails[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(DB_HINT);
  const { data, error } = await supabase
    .from("reservations")
    .select("*, reservation_attendees(attendees(*))")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Reservation & {
    reservation_attendees: { attendees: Attendee | null }[];
  };
  return (data as Row[]).map((row) => ({
    ...row,
    venue_name: row.venue_name ?? row.venue_id,
    venue_address: row.venue_address ?? "",
    attendees: row.reservation_attendees
      .map((ra) => ra.attendees)
      .filter((a): a is Attendee => a !== null),
  }));
}
```

`ReservationWithDetails` still declares `venue_name: string; venue_address: string;` — narrower than `Reservation`'s nullable versions. Change its declaration to omit them from the base:

```ts
export interface ReservationWithDetails
  extends Omit<Reservation, "venue_name" | "venue_address"> {
  venue_name: string;
  venue_address: string;
  attendees: Attendee[];
}
```

- [ ] **Step 4: Pass the snapshot when creating a plan**

In `src/components/ReservationModal.tsx`, find the `createReservation(` call near line 91 and add the snapshot fields to the object it passes:

```ts
        venue_id: venue.id,
        venue_name: venue.name,
        venue_address: venue.address,
        venue_lat: venue.lat,
        venue_lng: venue.lng,
        venue_ta_id: venue.ta_url ? venue.id.replace(/^ta-/, "") : null,
        venue_ta_url: venue.ta_url,
        venue_rating: venue.rating,
        venue_image_url: venue.image_url,
```

- [ ] **Step 5: Delete the seed pipeline**

```bash
git rm scripts/generate-seed.mjs supabase/migrations/0002_seed.sql src/data/venues.json
```

- [ ] **Step 6: Run the migration and verify**

Run `supabase/migrations/0003_live_venues.sql` in the Supabase SQL editor. Then:

```bash
npm run build && npm test
```

Expected: build and tests pass. In the app, save a plan and confirm it appears under "Saved plans" with the venue name intact.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0003_live_venues.sql src/lib/types.ts src/lib/reservations.ts src/components/ReservationModal.tsx
git commit -m "feat: drop venue catalog tables, snapshot venues onto reservations"
```

---

### Task 10: Room-block location guard

The highest-risk piece of extraction. Restaurant groups publish one shared events page covering every city they operate in; without this guard, Washington D.C.'s eight private rooms get attributed to the Times Square venue.

**Files:**
- Create: `src/lib/capacity-guard.ts`
- Create: `src/lib/capacity-guard.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface ExtractedBlock { name: string; seated: number | null; standing: number | null; notes: string | null; location_match: string | null }`
  - `acceptRoomBlock(block: ExtractedBlock, venue: { city: string; address: string; neighbourhood: string | null }): boolean`
  - `confidenceFor(rooms: { seated: number | null; standing: number | null }[]): "likely" | "unverified"`

- [ ] **Step 1: Write the failing tests**

Uses the real Carmine's data observed during design as the fixture.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- capacity-guard`
Expected: FAIL — cannot resolve `./capacity-guard`.

- [ ] **Step 3: Write the implementation**

```ts
export interface ExtractedBlock {
  name: string;
  seated: number | null;
  standing: number | null;
  notes: string | null;
  /** The city or address the page attributes this room to, if any. */
  location_match: string | null;
}

/** City-wide shorthands a page may use instead of the city name. */
const CITYWIDE_ALIASES: Record<string, string[]> = {
  "new york": ["nyc", "manhattan"],
  "san francisco": ["sf"],
  honolulu: ["oahu"],
};

/**
 * Neighbourhoods that distinguish one branch of a group from another. Naming
 * one of these is a claim about *which* location, so it must match the venue's
 * own neighbourhood or the block belongs to a different branch.
 */
const CITY_NEIGHBOURHOODS: Record<string, string[]> = {
  "new york": [
    "times square", "midtown", "upper west side", "upper east side",
    "downtown", "chelsea", "soho", "tribeca",
  ],
  "san francisco": ["soma", "financial district", "mission", "north beach"],
  honolulu: ["waikiki"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Restaurant groups publish one private-events page covering every city they
 * operate in. Without this guard, another branch's rooms get credited to this
 * venue — confidently wrong data, which is worse than none at all.
 *
 * Order matters: a street address is the strongest signal, the venue's own
 * neighbourhood next, and a *different* neighbourhood is a hard reject even
 * when the city matches. An unattributed block is accepted, since a
 * single-location page has no reason to name its own city.
 */
export function acceptRoomBlock(
  block: ExtractedBlock,
  venue: { city: string; address: string; neighbourhood: string | null }
): boolean {
  if (!block.location_match) return true;

  const claim = normalize(block.location_match);
  const city = normalize(venue.city);
  const address = normalize(venue.address);

  // Strongest signal: the page names this venue's street address.
  const street = address.match(
    /^\d+\s+[a-z0-9 ]+?(?:\s+(?:st|street|ave|avenue|rd|road|blvd))/
  );
  if (street && claim.includes(street[0].trim())) return true;

  const own = venue.neighbourhood ? normalize(venue.neighbourhood) : null;
  if (own && claim.includes(own)) return true;

  // A different neighbourhood of the same city means a different branch.
  const known = CITY_NEIGHBOURHOODS[city] ?? [];
  if (known.some((n) => n !== own && claim.includes(n))) return false;

  if (city && claim.includes(city)) return true;
  if ((CITYWIDE_ALIASES[city] ?? []).some((a) => claim.includes(a))) return true;

  return false;
}

export function confidenceFor(
  rooms: { seated: number | null; standing: number | null }[]
): "likely" | "unverified" {
  const hasNumber = rooms.some((r) => r.seated !== null || r.standing !== null);
  return hasNumber ? "likely" : "unverified";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 8 guard tests plus the earlier files.

If "Upper West Side, NYC" is accepted, the neighbourhood reject is not firing: check that `"upper west side"` is in `CITY_NEIGHBOURHOODS["new york"]` and that the fixture sets `neighbourhood: "Times Square"`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capacity-guard.ts src/lib/capacity-guard.test.ts src/lib/merge-venue.ts src/data/overlay.json
git commit -m "feat: guard extracted rooms against multi-location attribution"
```

---

### Task 11: Capacity extraction script

**Files:**
- Create: `scripts/extract-capacity.ts`
- Modify: `package.json` (dependencies + script)

Written in TypeScript and run with `tsx` so it imports the *tested* guard from `src/lib/capacity-guard.ts` directly. A hand-maintained JavaScript copy of that logic would be a second implementation of the one function whose correctness this whole feature rests on.

**Interfaces:**
- Consumes: `acceptRoomBlock`, `confidenceFor` (Task 10); TripAdvisor `/details` (Task 4); Supabase service role
- Produces: rows in `public.venue_capacity`

- [ ] **Step 1: Install the SDK and Zod**

```bash
npm install @anthropic-ai/sdk@^0.70 zod@^3
npm install -D tsx@^4
```

Add to `"scripts"` in `package.json`:

```json
"extract-capacity": "tsx scripts/extract-capacity.ts"
```

- [ ] **Step 2: Write the script**

Create `scripts/extract-capacity.ts`:

```ts
// Extracts private-dining room capacities from restaurants' own websites for
// TripAdvisor locations that have no curated overlay entry, and caches them in
// public.venue_capacity.
//
// TripAdvisor has no private-dining data and no free API returns it, so this is
// the only way to populate capacity for venues outside the curated overlay.
// Extracted data is never "verified" — see the trust rules in the spec.
//
// Usage:
//   TRIPADVISOR_API_KEY, ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL and
//   SUPABASE_SERVICE_ROLE_KEY in .env.local, then:
//   npm run extract-capacity -- <location_id> [<location_id> ...]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acceptRoomBlock, confidenceFor } from "../src/lib/capacity-guard";
import { overlayByLocationId } from "../src/lib/overlay";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(name: string): string | null {
  if (process.env[name]) return process.env[name];
  const p = join(root, ".env.local");
  if (existsSync(p)) {
    const m = readFileSync(p, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  return null;
}

const TA_KEY = env("TRIPADVISOR_API_KEY");
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
for (const [name, value] of [
  ["TRIPADVISOR_API_KEY", TA_KEY],
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
]) {
  if (!value) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: npm run extract-capacity -- <location_id> ...");
  process.exit(1);
}

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!);
const overlay = overlayByLocationId();

const RoomSchema = z.object({
  name: z.string(),
  seated: z.number().nullable(),
  standing: z.number().nullable(),
  notes: z.string().nullable(),
  location_match: z
    .string()
    .nullable()
    .describe(
      "The city, neighbourhood, or street address this page attributes this room to. Null if the page names no location for it."
    ),
});

const ExtractionSchema = z.object({
  rooms: z.array(RoomSchema),
});

async function details(locationId) {
  const url = new URL(
    `https://api.content.tripadvisor.com/api/v1/location/${locationId}/details`
  );
  url.searchParams.set("key", TA_KEY);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`details ${res.status}`);
  return res.json();
}

/** Fetch a page and reduce it to text; abandon anything that is not 200 HTML. */
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "PrivateDiningFinder/1.0 (+research tool)" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60_000);
}

/** Find a same-host private-dining page linked from the homepage. */
async function findEventsPage(homepage) {
  const res = await fetch(homepage, {
    headers: { "user-agent": "PrivateDiningFinder/1.0 (+research tool)" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const origin = new URL(homepage).origin;
  const links = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const hit = links.find((h) =>
    /private|events|parties|group|banquet/i.test(h)
  );
  if (!hit) return null;
  try {
    const abs = new URL(hit, origin);
    return abs.origin === origin ? abs.toString() : null;
  } catch {
    return null;
  }
}

const EXTRACTION_PROMPT = `You are reading a restaurant's website. Extract every private dining room or event space it describes.

For each space, record its name, seated capacity, standing/reception capacity, any notes, and — critically — the city, neighbourhood, or street address the page attributes that space to.

Restaurant groups often publish ONE page covering every location they operate. If the page covers several locations, set location_match to the location that space belongs to. If the page describes a single restaurant and names no location per space, set location_match to null.

Record only what the page states. Never infer or estimate a capacity: if no number is given, use null.`;

for (const id of ids) {
  try {
    const d = await details(id);
    const homepage = d.website;
    if (!homepage) {
      console.warn(`  ${id}: no website on the TripAdvisor listing`);
      continue;
    }

    const eventsUrl = (await findEventsPage(homepage)) ?? homepage;
    const text = await fetchText(eventsUrl);
    if (!text) {
      console.warn(`  ${id}: could not read ${eventsUrl}`);
      continue;
    }

    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4096,
      output_config: { format: zodOutputFormat(ExtractionSchema) },
      messages: [
        { role: "user", content: `${EXTRACTION_PROMPT}\n\n---\n\n${text}` },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      console.warn(`  ${id}: extraction returned nothing`);
      continue;
    }

    const venue = {
      city: d.address_obj?.city ?? "",
      address: d.address_obj?.address_string ?? "",
      // Curated venues know which branch they are; live-only ones do not.
      neighbourhood: overlay.get(String(id))?.neighbourhood ?? null,
    };
    const kept = parsed.rooms.filter((r) => acceptRoomBlock(r, venue));
    const dropped = parsed.rooms.length - kept.length;

    if (kept.length === 0) {
      console.warn(`  ${id}: no rooms survived the location guard`);
      continue;
    }

    const { error } = await supabase.from("venue_capacity").upsert({
      ta_location_id: String(id),
      rooms: kept.map(({ name, seated, standing, notes }) => ({
        name, seated, standing, notes,
      })),
      source_url: eventsUrl,
      confidence: confidenceFor(kept),
      extracted_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    console.log(
      `  ✓ ${id}: ${kept.length} room(s)` +
        (dropped > 0 ? `, ${dropped} dropped as another location` : "")
    );
  } catch (e) {
    console.warn(`  ${id}: ${e.message}`);
  }
  // One request per host per second is polite; these are small sites.
  await new Promise((r) => setTimeout(r, 1000));
}
```

- [ ] **Step 3: Run it against a known-hard case**

```bash
npm run extract-capacity -- <the location_id you matched for Carmine's>
```

Expected: `✓ <id>: N room(s), M dropped as another location` — the D.C., Las Vegas, Atlantic City, and Upper West Side rooms must be among the dropped. If they are kept, the guard is not firing; stop and fix it before running the script over more venues, or the cache fills with confidently wrong capacities.

The script always re-extracts and upserts, so refreshing a stale entry is just running it again on that id. The spec's 30-day staleness window is a re-run cadence, not code: nothing expires rows automatically, and `extracted_at` is there so you can find the old ones (`select ta_location_id from venue_capacity where extracted_at < now() - interval '30 days'`).

- [ ] **Step 4: Commit**

```bash
git add scripts/extract-capacity.ts package.json package-lock.json
git commit -m "feat: extract private-dining capacities from restaurant websites"
```

---

### Task 12: Read the capacity cache in search

**Files:**
- Modify: `src/app/api/venues/search/route.ts`
- Create: `src/lib/capacity-cache.ts`

**Interfaces:**
- Consumes: `CapacityEntry` (Task 5), Supabase anon client
- Produces: `loadCapacity(locationIds: string[]): Promise<Map<string, CapacityEntry>>`

- [ ] **Step 1: Write the cache reader**

Create `src/lib/capacity-cache.ts`:

```ts
import { getSupabase } from "./supabase";
import type { CapacityEntry } from "./merge-venue";
import type { Room } from "./types";

interface Row {
  ta_location_id: string;
  rooms: Room[] | null;
  source_url: string | null;
  confidence: "likely" | "unverified";
}

/** Extracted capacity for the given locations. Empty when the DB is down. */
export async function loadCapacity(
  locationIds: string[]
): Promise<Map<string, CapacityEntry>> {
  const map = new Map<string, CapacityEntry>();
  if (locationIds.length === 0) return map;
  const supabase = getSupabase();
  if (!supabase) return map;

  try {
    const { data, error } = await supabase
      .from("venue_capacity")
      .select("ta_location_id, rooms, source_url, confidence")
      .in("ta_location_id", locationIds);
    if (error || !data) return map;
    for (const row of data as Row[]) {
      map.set(row.ta_location_id, {
        ta_location_id: row.ta_location_id,
        rooms: row.rooms ?? [],
        source_url: row.source_url,
        confidence: row.confidence,
      });
    }
  } catch {
    // Search still works without extracted capacity; venues fall back to
    // "needs a call" rather than failing the request.
  }
  return map;
}
```

- [ ] **Step 2: Wire it into the route**

In `src/app/api/venues/search/route.ts`, after the `details` array is built and before `venues` is mapped:

```ts
    const capacity = await loadCapacity(details.map((d) => d.location_id));

    const venues: Venue[] = details
      .filter((d) => haversineKm(lat, lng, d.lat, d.lng) <= radiusKm)
      .map((d) =>
        mergeVenue(d, overlay.get(d.location_id), capacity.get(d.location_id))
      );
```

Add the import:

```ts
import { loadCapacity } from "@/lib/capacity-cache";
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm run dev
curl -s "http://localhost:3000/api/venues/search?lat=40.7580&lng=-73.9855&minutes=20&mode=walking" \
  | grep -o '"trust_label":"likely"' | wc -l
```

Expected: at least 1, assuming Task 11 extracted at least one venue in that radius.

- [ ] **Step 4: Commit**

```bash
git add src/lib/capacity-cache.ts src/app/api/venues/search/route.ts
git commit -m "feat: serve extracted capacities from the search route"
```

---

### Task 13: TripAdvisor attribution

Required by TripAdvisor's display terms: their bubble image rather than our stars, a logo, and a link to the listing.

**Files:**
- Create: `public/tripadvisor.svg`
- Modify: `src/components/Badges.tsx:50-69` (`Stars`)
- Modify: `src/components/VenueCard.tsx:92-104`

- [ ] **Step 1: Add the logo**

Download the official logo from TripAdvisor's brand resources (linked from the [display requirements](https://tripadvisor-content-api.readme.io/reference/display-requirements)) and save it as `public/tripadvisor.svg`. Use the primary black logo on our light background. Do not recolour, invert, or redraw it — an approximated logo fails the display terms as surely as no logo at all.

If you cannot obtain the asset, stop and ask rather than substituting a lookalike: shipping attribution that misrepresents their mark is worse than shipping the feature a day later.

- [ ] **Step 2: Replace `Stars` with the attributed version**

In `src/components/Badges.tsx`, replace the `Stars` function (lines 50-69):

```tsx
export function Stars({
  rating,
  bubbleUrl,
}: {
  rating: number | null;
  bubbleUrl?: string | null;
}) {
  if (rating === null) {
    return <span className="text-[12px] text-ink-soft">No rating</span>;
  }
  // TripAdvisor's display terms require their bubble image over our own icons.
  if (bubbleUrl) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bubbleUrl}
          alt={`${rating.toFixed(1)} of 5 bubbles`}
          className="h-[14px] w-auto"
          loading="lazy"
        />
        <span className="font-data text-[12px] font-medium text-ink">
          {rating.toFixed(1)}
        </span>
      </span>
    );
  }
  // Fallback for venues with no live TripAdvisor record.
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <span className="inline-flex items-center gap-1.5" title={`${rating.toFixed(1)} stars`}>
      <span className="relative inline-block text-[13px] leading-none tracking-[1px]">
        <span className="text-hairline">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden whitespace-nowrap text-brass"
          style={{ width: `${pct}%` }}
        >
          ★★★★★
        </span>
      </span>
      <span className="font-data text-[12px] font-medium text-ink">{rating.toFixed(1)}</span>
    </span>
  );
}
```

- [ ] **Step 3: Pass the bubble URL and add the logo link**

In `src/components/VenueCard.tsx`, replace line 96:

```tsx
              <Stars rating={venue.rating} bubbleUrl={venue.ta_rating_image_url} />
```

And after the `PriceSignal` on line 103, add the attribution link:

```tsx
              {venue.ta_url && (
                <a
                  href={venue.ta_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] text-ink-soft hover:underline"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/tripadvisor.svg" alt="Tripadvisor" className="h-[20px] w-auto" />
                  <span>View listing</span>
                </a>
              )}
```

- [ ] **Step 4: Show the capacity source**

In the expanded room section of `VenueCard.tsx`, add below the room list:

```tsx
          {venue.capacity_source_url && (
            <p className="mt-1 text-[11px] text-ink-soft">
              Capacity from the{" "}
              <a
                href={venue.capacity_source_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline"
              >
                restaurant&rsquo;s site
              </a>{" "}
              — confirm by phone.
            </p>
          )}
```

- [ ] **Step 5: Verify**

```bash
npm run build && npm run dev
```

Open the app, run a search, and confirm each card shows a TripAdvisor bubble image, a logo at least 20px high, and a working listing link. Venues with extracted capacity show the source line.

- [ ] **Step 6: Commit**

```bash
git add public/tripadvisor.svg src/components/Badges.tsx src/components/VenueCard.tsx
git commit -m "feat: add required TripAdvisor attribution to venue cards"
```

---

### Task 14: Result cap, booking copy, and documentation

**Files:**
- Modify: `src/app/page.tsx:90-92`, `:144-151`
- Modify: `src/components/ReservationModal.tsx:152-156`
- Modify: `README.md`

- [ ] **Step 1: Cap the list at 20**

In `src/app/page.tsx`, replace lines 90-92:

```ts
  const MAX_RESULTS = 20;
  const allResults = ranked?.results ?? [];
  const results = allResults.slice(0, MAX_RESULTS);
  const top = results.slice(0, 3);
  const rest = results.slice(3);
```

- [ ] **Step 2: State the truncation**

Replace the heading (lines 145-147) so a capped list never reads as the whole set:

```tsx
                <h2 className="font-display text-[16px] font-semibold text-ink">
                  {allResults.length > MAX_RESULTS
                    ? `Top ${MAX_RESULTS} of ${allResults.length} venues found`
                    : `${allResults.length} venue${allResults.length === 1 ? "" : "s"} found`}
                </h2>
```

- [ ] **Step 3: Make the mock booking explicit**

In `src/components/ReservationModal.tsx`, replace the success copy at line 154:

```tsx
              The dinner and its attendees are saved. This is a plan only — no
              reservation has been made and the restaurant has not been contacted.
              Find it any time under Saved plans, and
```

- [ ] **Step 4: Rewrite the README**

Replace the "(Optional) Refresh venue data from Yelp" section (lines 57-68) with:

````markdown
### 3. Venue data

Venues are fetched live from the [TripAdvisor Content API](https://tripadvisor-content-api.readme.io/)
per search — there is no seeded venue catalog. Add a key to `.env.local`:

```
TRIPADVISOR_API_KEY=...
```

Getting one: sign up at [tripadvisor.com/developers](https://www.tripadvisor.com/developers).
The first 5,000 calls each month are free, **a credit card is required at signup** for overage,
and TripAdvisor will not issue the key until you restrict it to an **IPv4 address or domain**.
For local development that means your machine's current public IP — which you must update
whenever it changes.

TripAdvisor has no private-dining data, so room capacities come from two other places:

- `src/data/overlay.json` — hand-curated rooms and group-sales contacts, keyed by
  TripAdvisor `location_id`. These venues are labelled **verified**.
- `public.venue_capacity` — capacities extracted from restaurants' own websites by
  `npm run extract-capacity -- <location_id> ...`. Labelled **likely** (a capacity was
  stated) or **needs a call** (rooms found, no numbers). Every extracted venue links to the
  page it came from so a planner can check.

Venues with neither are shown honestly as **needs a call**.
````

Also update the "Result data per venue" bullet (line 22) to say "TripAdvisor rating" rather than "Yelp-style star rating", and replace the "Live data" bullet under "With more time" (line 107) since it is now done.

- [ ] **Step 5: Verify**

```bash
npm run build && npm test && npx eslint
```

Expected: all pass. In the app, run a broad search and confirm the heading reads "Top 20 of N venues found" and only 20 cards render.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/ReservationModal.tsx README.md
git commit -m "feat: cap results at 20, clarify plans are not reservations, update README"
```

---

### Task 15: Unconfirmed dietary, not disqualified

**Execute this immediately after Task 2** — it is numbered 15 only so the brief tooling can
extract it. It changes `ranking.ts`, which Task 2 also touches, so it must not run concurrently
with that task.

TripAdvisor has no dietary field (the location response carries `cuisine`, `features`, and
`price_level` — no `dietary_restrictions`), so `mergeVenue` gives every live-only venue
`dietary: []`. `ranking.ts` currently drops any venue whose `dietary` array lacks a requested
tag, which means ticking any dietary box would exclude every live venue and return an empty
list. Unknown must mean unconfirmed, not disqualified — the same rule capacity already follows.

**Files:**
- Modify: `src/lib/ranking.ts` (the dietary filter, currently ~lines 89-95)
- Modify: `src/lib/types.ts` (`RankedVenue`)
- Modify: `src/lib/ranking.test.ts` (add cases)
- Modify: `src/components/VenueCard.tsx` (surface the unconfirmed state)

**Interfaces:**
- Consumes: `RankedVenue`, `rankVenues` (Task 2)
- Produces: `RankedVenue.dietaryUnconfirmed: boolean` — true when the user requested dietary
  accommodations and this venue has no dietary data at all.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ranking.test.ts`:

```ts
describe("rankVenues with unconfirmed dietary", () => {
  const vegParams: SearchParams = { ...params, dietary: ["vegetarian"] };

  it("excludes a venue whose known dietary list lacks the request", () => {
    const known = venue({ id: "known", dietary: ["vegan"], rooms: [room({ seated: 60 })] });
    const { results, excludedByDietary } = rankVenues([known], vegParams);
    expect(results).toHaveLength(0);
    expect(excludedByDietary).toBe(1);
  });

  it("keeps a venue with no dietary data and flags it unconfirmed", () => {
    const live = venue({ id: "live", dietary: [], rooms: [room({ seated: 60 })] });
    const { results, excludedByDietary } = rankVenues([live], vegParams);
    expect(results).toHaveLength(1);
    expect(results[0].dietaryUnconfirmed).toBe(true);
    expect(results[0].dietaryMissing).toEqual(["vegetarian"]);
    expect(excludedByDietary).toBe(0);
  });

  it("keeps a venue that genuinely accommodates, unflagged", () => {
    const ok = venue({ id: "ok", dietary: ["vegetarian"], rooms: [room({ seated: 60 })] });
    const { results } = rankVenues([ok], vegParams);
    expect(results).toHaveLength(1);
    expect(results[0].dietaryUnconfirmed).toBe(false);
    expect(results[0].dietaryMissing).toEqual([]);
  });

  it("flags nothing when no dietary need was requested", () => {
    const live = venue({ id: "live", dietary: [], rooms: [room({ seated: 60 })] });
    const { results } = rankVenues([live], params);
    expect(results[0].dietaryUnconfirmed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- ranking`
Expected: FAIL — `dietaryUnconfirmed` does not exist, and the second case returns 0 results
because the current filter excludes it.

- [ ] **Step 3: Add the field to `RankedVenue`**

In `src/lib/types.ts`, add to `RankedVenue` after `dietaryMissing: string[];`:

```ts
  /** User asked for dietary accommodations and this venue has no dietary data. */
  dietaryUnconfirmed: boolean;
```

- [ ] **Step 4: Change the filter in `ranking.ts`**

Replace the dietary block (currently ~lines 89-95):

```ts
    // Unknown dietary data is unconfirmed, not disqualifying — the same rule
    // capacity follows. A venue with a curated list that lacks a requested tag
    // is genuinely excluded; a live venue with no list at all is kept and
    // flagged, because TripAdvisor supplies no dietary data and excluding on
    // its absence would empty the results whenever any box is ticked.
    const dietaryKnown = venue.dietary.length > 0;
    const dietaryMissing = params.dietary.filter(
      (d) => !venue.dietary.includes(d)
    );
    if (dietaryKnown && dietaryMissing.length > 0) {
      excludedByDietary++;
      continue;
    }
    const dietaryUnconfirmed = !dietaryKnown && params.dietary.length > 0;
```

Then add `dietaryUnconfirmed` to the object pushed into `scored` (alongside `dietaryMissing`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all files green, including Task 2's four capacity cases.

- [ ] **Step 6: Surface it on the card**

In `src/components/VenueCard.tsx`, find where `dietaryMissing` is rendered. Where the venue is
flagged `dietaryUnconfirmed`, the card must say the need is unconfirmed rather than met or
missing — for example `Vegetarian: unconfirmed — confirm by phone` instead of listing it as
missing. Match the surrounding markup and class names; do not restructure the card.

- [ ] **Step 7: Verify**

```bash
npm test && npx eslint && npm run build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ranking.ts src/lib/types.ts src/lib/ranking.test.ts src/components/VenueCard.tsx
git commit -m "feat: treat missing dietary data as unconfirmed rather than disqualifying"
```

---

## Verification checklist

Run before considering the plan complete:

- [ ] `npm test` — all unit tests pass
- [ ] `npm run build` — clean production build
- [ ] `npx eslint` — no errors
- [ ] `git grep -i yelp` returns only historical commit messages
- [ ] A search returns live TripAdvisor venues with bubble images and listing links
- [ ] At least one venue shows curated (`verified`) capacity and one shows extracted (`likely`)
- [ ] Saving a plan works, and the plan still renders after the venue's TripAdvisor record is unavailable
- [ ] With `TRIPADVISOR_API_KEY` unset, search falls back to curated venues with a visible notice
