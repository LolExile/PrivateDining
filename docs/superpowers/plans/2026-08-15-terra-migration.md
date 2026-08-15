# Terra Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the shipped TripAdvisor integration from the legacy Content API to Terra, cap results at 10 restaurants, add a photo per venue, and remove cuisine from ranking.

**Architecture:** Terra paginates properly, so the 13-point grid fan-out is deleted in favour of a single centre call that pages until 10 restaurants are collected. Restaurants are filtered client-side because Terra's documented `category` filter is validated but not applied. Each surviving restaurant then gets one details call and one photo call.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Vitest · TripAdvisor Terra API

**Spec:** `docs/superpowers/specs/2026-08-14-tripadvisor-live-venues-design.md` — see its **Terra migration addendum**, which supersedes §4–§7 and §11 of that document.

**Predecessor:** `docs/superpowers/plans/2026-08-14-tripadvisor-live-venues.md` (Tasks 1–15, complete). This plan amends that work; it does not repeat it.

## Global Constraints

- Base URL `https://terra.tripadvisor.com/api`. Auth is the **`X-API-Key` request header** — never a query parameter. Server-only.
- **Billing is per location returned.** 1,000 free entities once per account lifetime, then ~$0.015 each. Every avoidable location fetch is real money. Fetch the fewest locations that satisfy the request.
- **Never call `/locations/{id}/reviews`.** It exists, it is expensive, and nothing in the app ranks on it.
- **`category=RESTAURANT` does not filter.** Its enum is validated — invalid values error — but the filter is not applied. Filter client-side on `urls.tripadvisor.main` matching `/Restaurant_Review`.
- **`pagination.total_elements` is unreliable** — it tracks page size, not matches. Never use it as a count.
- **10 results**, not 20.
- **Cuisine is unavailable from Terra** and leaves the ranker.
- Test files import `describe`/`it`/`expect` explicitly from `vitest`; globals stay disabled and `tsconfig.json` stays untouched.
- `npm test`, `npx eslint`, `npm run build` must pass at every task boundary.
- The repository owner commits to `main` concurrently and edits `README.md`. Commit only your task's files.

---

### Task 16: Terra API client

Replaces the legacy client wholesale.

**Files:**
- Rewrite: `src/lib/tripadvisor.ts`
- Rewrite: `src/lib/tripadvisor-parse.ts` and `src/lib/tripadvisor-parse.test.ts`
- Create: `src/lib/tripadvisor.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `TripAdvisorError` (numeric `status`), `TerraNearby`, `TerraDetails`, `isRestaurant(main)`, `parsePriceLevel(raw)`, `nearbyRestaurants(lat, lng, radiusKm, needed)`, `locationDetails(id)`, `locationPhoto(id)`

- [ ] **Step 1: Replace the price parser**

Terra returns `price_level` as a label like `"Mid Range"`, not the legacy `"$$ - $$$"`. Replace the body of `src/lib/tripadvisor-parse.ts`:

```ts
/**
 * Terra returns price_level as a label ("Mid Range"), not a run of dollar
 * signs. Only "Mid Range" has been observed on a live response, so this map is
 * deliberately conservative: an unrecognised label returns null rather than a
 * guessed tier, because a wrong price tier is worse than a missing one.
 */
const PRICE_LABELS: Record<string, number> = {
  "cheap eats": 1,
  "mid range": 2,
  "mid-range": 2,
  "fine dining": 4,
};

export function parsePriceLevel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const label = raw.trim().toLowerCase();
  if (label in PRICE_LABELS) return PRICE_LABELS[label];
  // Some records may still carry the legacy dollar-sign form.
  const runs = raw.match(/\$+/g);
  if (!runs) return null;
  return Math.min(4, Math.max(1, Math.max(...runs.map((r) => r.length))));
}
```

- [ ] **Step 2: Rewrite the parser's tests**

Replace `src/lib/tripadvisor-parse.test.ts` entirely:

```ts
import { describe, it, expect } from "vitest";
import { parsePriceLevel } from "./tripadvisor-parse";

describe("parsePriceLevel", () => {
  it("maps Terra's labels", () => {
    expect(parsePriceLevel("Cheap Eats")).toBe(1);
    expect(parsePriceLevel("Mid Range")).toBe(2);
    expect(parsePriceLevel("Fine Dining")).toBe(4);
  });

  it("is case and hyphen tolerant", () => {
    expect(parsePriceLevel("  mid range ")).toBe(2);
    expect(parsePriceLevel("Mid-Range")).toBe(2);
  });

  it("returns null for an unrecognised label rather than guessing", () => {
    expect(parsePriceLevel("Gastropub")).toBeNull();
  });

  it("still understands the legacy dollar form", () => {
    expect(parsePriceLevel("$$ - $$$")).toBe(3);
    expect(parsePriceLevel("$$$$$$")).toBe(4);
  });

  it("returns null for null, undefined and empty", () => {
    expect(parsePriceLevel(null)).toBeNull();
    expect(parsePriceLevel(undefined)).toBeNull();
    expect(parsePriceLevel("")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the parser tests**

Run: `npm test -- tripadvisor-parse`
Expected: the label cases FAIL against the old `$`-counting implementation until Step 1 is in place; all pass after.

- [ ] **Step 4: Write the Terra client**

Replace `src/lib/tripadvisor.ts` entirely:

```ts
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
```

- [ ] **Step 5: Test the pure helper**

Create `src/lib/tripadvisor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isRestaurant } from "./tripadvisor";

describe("isRestaurant", () => {
  it("accepts a restaurant review URL", () => {
    expect(
      isRestaurant(
        "https://www.tripadvisor.com/Restaurant_Review-g60763-d5041840-Reviews-Bucca_Di_Beppo.html"
      )
    ).toBe(true);
  });

  it("rejects an attraction review URL", () => {
    expect(
      isRestaurant(
        "https://www.tripadvisor.com/Attraction_Review-g60763-d12484443-Reviews-Parrott_Tours.html"
      )
    ).toBe(false);
  });

  it("rejects null, undefined and empty", () => {
    expect(isRestaurant(null)).toBe(false);
    expect(isRestaurant(undefined)).toBe(false);
    expect(isRestaurant("")).toBe(false);
  });
});
```

- [ ] **Step 6: Verify, including one live call**

```bash
npm test && npx eslint && npm run build
```

Then one live smoke test. The key in `.env.local` is known to work against Terra:

```bash
curl -s -o /dev/null -w "HTTP:%{http_code}\n" \
  -H "X-API-Key: $(grep '^TRIPADVISOR_API_KEY=' .env.local | cut -d= -f2)" \
  "https://terra.tripadvisor.com/api/catalog/locations/nearby?lat=40.7580&lon=-73.9855&radius=2&unit=KM&size=1"
```

Expected: `HTTP:200`. Use `size=1` — this is a billable call and one location is enough to prove the header works. A 403 means the header handling regressed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tripadvisor.ts src/lib/tripadvisor-parse.ts src/lib/tripadvisor-parse.test.ts src/lib/tripadvisor.test.ts
git commit -m "feat: migrate the TripAdvisor client to the Terra API"
```

---

### Task 17: Route on Terra, 10 results, photos

**Files:**
- Rewrite: `src/app/api/venues/search/route.ts`
- Modify: `src/lib/merge-venue.ts` (accept the Terra shapes)
- Delete: `src/lib/search-grid.ts`, `src/lib/search-grid.test.ts`
- Modify: `src/lib/tripadvisor-parse.ts` — no change; listed only so you do not touch it

**Interfaces:**
- Consumes: `nearbyRestaurants`, `locationDetails`, `locationPhoto`, `TerraNearby`, `TerraDetails`, `TripAdvisorError` (Task 16); `mergeVenue`, `OverlayEntry`, `CapacityEntry` (Task 5)
- Produces: `GET /api/venues/search?lat&lng&minutes&mode` → `{ venues: Venue[], source, notice }`, at most 10 venues

- [ ] **Step 1: Delete the grid**

```bash
git rm src/lib/search-grid.ts src/lib/search-grid.test.ts
```

It existed solely to work around legacy's 10-result cap with no pagination. Terra pages, so it is dead weight — and under per-entity billing its 13 points would cost roughly 260 entities per search, exhausting the lifetime free allowance in four searches.

The route still needs the commute-radius inversion that lived in that file. Move `commuteRadiusKm` into `src/lib/geo.ts`, beside the `commuteMinutes` it inverts, and export it:

```ts
/** Straight-line radius reachable within the commute limit; inverse of commuteMinutes. */
export function commuteRadiusKm(
  maxCommuteMinutes: number,
  mode: CommuteMode
): number {
  const km = (maxCommuteMinutes * SPEED_KMH[mode]) / (ROUTE_FACTOR * 60);
  return Math.min(km, SEARCH_RADIUS_MILES / 0.621371);
}
```

Add a test for it in a new `src/lib/geo.test.ts`, carrying over the three cases the deleted suite had:

```ts
import { describe, it, expect } from "vitest";
import { commuteRadiusKm, kmToMiles } from "./geo";

describe("commuteRadiusKm", () => {
  it("inverts the walking estimate", () => {
    expect(commuteRadiusKm(20, "walking")).toBeCloseTo(1.231, 2);
  });
  it("inverts the driving estimate", () => {
    expect(commuteRadiusKm(15, "driving")).toBeCloseTo(5.385, 2);
  });
  it("clamps to the 20-mile hard radius", () => {
    expect(kmToMiles(commuteRadiusKm(600, "driving"))).toBeCloseTo(20, 5);
  });
});
```

- [ ] **Step 2: Adapt `mergeVenue` to the Terra shape**

`mergeVenue`'s first argument is currently the legacy `TaDetails`. Change its signature to take the Terra pair:

```ts
export function mergeVenue(
  live: TerraNearby & Partial<TerraDetails>,
  overlay: OverlayEntry | undefined,
  capacity: CapacityEntry | undefined
): Venue
```

Inside, the only changes are the field names: `live.taUrl` for `ta_url`, `live.ratingImageUrl` for `ta_rating_image_url`, `live.website` for `menu_url`, `live.phone ?? null` for the contact phone fallback, `live.price_tier ?? null` for `price_tier`, and `live.id` for `ta_location_id`. **Cuisine has no source** — set `cuisine: overlay?.cuisine ?? "Restaurant"`, and add `cuisine: string | null` to `OverlayEntry` so curated venues keep theirs.

Update `src/lib/merge-venue.test.ts`'s fixtures to the new shape. The seven precedence assertions stay — they are about precedence, not field names, and must all still pass.

- [ ] **Step 3: Rewrite the route**

`src/app/api/venues/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { commuteRadiusKm } from "@/lib/geo";
import { haversineKm } from "@/lib/geo";
import { loadCapacity } from "@/lib/capacity-cache";
import { mergeVenue } from "@/lib/merge-venue";
import { overlayByLocationId } from "@/lib/overlay";
import {
  locationDetails,
  locationPhoto,
  nearbyRestaurants,
  TripAdvisorError,
} from "@/lib/tripadvisor";
import type { CommuteMode, Venue } from "@/lib/types";

/** The owner's requirement: ten restaurants, not twenty. */
const MAX_RESULTS = 10;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const num = (key: string): number => {
    const raw = url.searchParams.get(key);
    return raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  };
  const lat = num("lat");
  const lng = num("lng");
  const minutes = num("minutes");
  const mode = (url.searchParams.get("mode") ?? "walking") as CommuteMode;

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

  try {
    const found = await nearbyRestaurants(lat, lng, radiusKm, MAX_RESULTS);
    const inRadius = found.filter(
      (r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm
    );

    // One details call and one photo call per surviving restaurant. Both are
    // billable per location, so they run only for venues that will be shown.
    const enriched = await Promise.all(
      inRadius.map(async (r) => {
        const [details, photo] = await Promise.all([
          locationDetails(r.id).catch(() => null),
          locationPhoto(r.id).catch(() => null),
        ]);
        return { ...r, ...(details ?? {}), image_url: photo };
      })
    );

    const capacity = await loadCapacity(enriched.map((r) => r.id));
    const venues: Venue[] = enriched.map((r) => {
      const v = mergeVenue(r, overlay.get(r.id), capacity.get(r.id));
      return { ...v, image_url: r.image_url };
    });

    return NextResponse.json({ venues, source: "live", notice: null });
  } catch (error) {
    const notice =
      error instanceof TripAdvisorError
        ? error.status === 401 || error.status === 403
          ? "Tripadvisor rejected the API key — check TRIPADVISOR_API_KEY."
          : error.status === 429
            ? "Tripadvisor rate limit reached — showing curated venues only."
            : "Live data unavailable — showing curated venues only."
        : "Live data unavailable — showing curated venues only.";
    return NextResponse.json({ venues: [], source: "overlay", notice });
  }
}
```

Note there is no grid, no candidate cap, and no overlay union: Terra pages properly, and a curated venue in range will surface in the nearby results like any other.

- [ ] **Step 4: Verify, and count the entity cost**

```bash
npx tsc --noEmit && npm test && npx eslint && npm run build
```

Then run one real search against the dev server and report both the result count and the venues:

```bash
curl -s "http://localhost:3000/api/venues/search?lat=40.7580&lng=-73.9855&minutes=20&mode=walking" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('count',j.venues.length,'notice',j.notice);j.venues.forEach(v=>console.log(' -',v.name,'|',v.price_tier,'|',v.rating,'|',v.image_url?'photo':'no photo'))})"
```

Expected: up to 10 venues, all restaurants, each with a rating and most with a photo. **Report the actual count and names** — this is the first genuinely live verification in the project.

- [ ] **Step 5: Commit**

```bash
git add -A src/app/api/venues/search/route.ts src/lib/merge-venue.ts src/lib/merge-venue.test.ts src/lib/geo.ts src/lib/geo.test.ts src/lib/overlay.ts
git commit -m "feat: search Terra for 10 restaurants with photos, drop the grid"
```

---

### Task 18: Remove cuisine from ranking

**Files:**
- Modify: `src/lib/ranking.ts`
- Modify: `src/lib/ranking.test.ts`

- [ ] **Step 1: Reweight**

Terra supplies no cuisine, so a 35-weight factor scoring on a field that is null for every live venue would sink every live result. Remove the cuisine factor and redistribute proportionally, preserving the originally stated priority order. In `src/lib/ranking.ts`:

```ts
/**
 * Cuisine left the ranker when the app moved to Terra, which supplies no
 * cuisine field. Its 35 points were redistributed proportionally so the
 * remaining factors keep their original relative importance.
 */
const WEIGHTS = {
  capacity: 38,
  commute: 31,
  rooms: 15,
  price: 9,
  trust: 7,
};
```

Delete the `if (params.cuisine) { factors.push({ key: "cuisine", ... }) }` block and the cuisine hard-sort in the final `scored.sort(...)`, which becomes a plain descending sort on `totalScore`. Keep `cuisineMatch` on `RankedVenue` — the card still shows whether a venue matches, it just no longer scores.

- [ ] **Step 2: Update the tests**

The existing suite has cases that assert cuisine-driven ordering. Update only those; every capacity, dietary and price assertion must still pass untouched. Add one case proving cuisine no longer affects order:

```ts
it("does not rank on cuisine", () => {
  const a = venue({ id: "a", cuisine: "Italian", rooms: [room({ seated: 60 })] });
  const b = venue({ id: "b", cuisine: "Thai", rooms: [room({ seated: 60 })] });
  const withCuisine = rankVenues([b, a], { ...params, cuisine: "Italian" });
  const without = rankVenues([b, a], params);
  expect(withCuisine.results.map((r) => r.venue.id)).toEqual(
    without.results.map((r) => r.venue.id)
  );
});
```

- [ ] **Step 3: Verify and commit**

```bash
npm test && npx eslint && npm run build
git add src/lib/ranking.ts src/lib/ranking.test.ts
git commit -m "feat: drop cuisine from ranking, redistribute its weight"
```

---

### Task 19: UI — 10 results, Terra attribution, cuisine display-only

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/Badges.tsx`
- Modify: `src/components/VenueCard.tsx`
- Modify: `src/components/ReservationModal.tsx`

- [ ] **Step 1: Cap at 10 and state truncation**

In `src/app/page.tsx`, replace `const results = ranked?.results ?? [];` with:

```ts
  const MAX_RESULTS = 10;
  const allResults = ranked?.results ?? [];
  const results = allResults.slice(0, MAX_RESULTS);
```

and change the results heading so a capped list never reads as the whole set:

```tsx
                <h2 className="font-display text-[16px] font-semibold text-ink">
                  {allResults.length > MAX_RESULTS
                    ? `Top ${MAX_RESULTS} of ${allResults.length} venues found`
                    : `${allResults.length} venue${allResults.length === 1 ? "" : "s"} found`}
                </h2>
```

- [ ] **Step 2: Clear the notice on error**

In the same file's `catch` block, add `setNotice(null);` before `setSearchError(...)`, so a stale banner cannot sit beside a fresh error.

- [ ] **Step 3: Cuisine dropdown offers only what results contain**

Replace the `cuisines` memo with one that derives solely from live results, and render nothing selectable before the first search:

```ts
  const cuisines = useMemo(
    () => [...new Set(venues.map((v) => v.cuisine).filter(Boolean))].sort(),
    [venues]
  );
```

No hardcoded fallback list — Terra supplies no cuisine, so inventing options would offer filters that match nothing.

- [ ] **Step 4: Attribution from Terra's own bubble image**

`Stars` in `src/components/Badges.tsx` takes an optional `bubbleUrl` and renders TripAdvisor's image when present, falling back to the hand-rolled stars when null:

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

In `src/components/VenueCard.tsx`, pass it: `<Stars rating={venue.rating} bubbleUrl={venue.ta_rating_image_url} />`, and add a listing link beside the price signal when `venue.ta_url` is set:

```tsx
              {venue.ta_url && (
                <a
                  href={venue.ta_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] text-ink-soft underline"
                >
                  View on Tripadvisor
                </a>
              )}
```

**Do not fabricate a TripAdvisor logo.** Their display terms require the official mark; if you believe one is needed, stop and report it rather than drawing a lookalike.

- [ ] **Step 5: Make the mock booking explicit**

In `src/components/ReservationModal.tsx`, replace the success copy that currently reads "The dinner and its attendees are stored." with wording stating plainly that this is a plan only, no reservation has been made, and the restaurant has not been contacted.

- [ ] **Step 6: Verify and commit**

```bash
npm test && npx eslint && npm run build
```

Then run a real search in the browser and confirm: at most 10 cards, each showing a TripAdvisor bubble image and a working listing link, and a photo where one was returned.

```bash
git add src/app/page.tsx src/components/Badges.tsx src/components/VenueCard.tsx src/components/ReservationModal.tsx
git commit -m "feat: cap results at 10, attribute via Terra bubble images"
```

---

### Task 20: Scripts and documentation on Terra

**Files:**
- Rewrite: `scripts/match-overlay.mjs` (Terra search endpoint)
- Modify: `scripts/extract-capacity.ts` (add cuisine to the extraction)
- Modify: `README.md`

- [ ] **Step 1: Point the matcher at Terra**

In `scripts/match-overlay.mjs`, replace the legacy search call with Terra's:

```js
async function search(name, lat, lng) {
  const url = new URL("https://terra.tripadvisor.com/api/catalog/locations/nearby");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("radius", "2");
  url.searchParams.set("unit", "KM");
  url.searchParams.set("size", "20");
  url.searchParams.set("sort", "distance,asc");
  const res = await fetch(url, {
    headers: { "X-API-Key": KEY, accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    console.error("Tripadvisor rejected the key. Check TRIPADVISOR_API_KEY in .env.local.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`nearby ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const wanted = name.toLowerCase();
  const rows = (json.data ?? []).filter((d) =>
    /\/Restaurant_Review/.test(d.location?.urls?.tripadvisor?.main ?? "")
  );
  // Prefer a name match; fall back to the nearest restaurant.
  const hit =
    rows.find((d) =>
      (d.location.names?.[0]?.value ?? "").toLowerCase().includes(wanted)
    ) ?? rows[0];
  return hit
    ? { location_id: String(hit.location.id), name: hit.location.names?.[0]?.value }
    : null;
}
```

Keep the existing structure: the transform still runs without a key, and matches are still written as `_match_candidate` for human review rather than applied automatically.

- [ ] **Step 2: Extract cuisine alongside capacity**

Terra has no cuisine field, but the extractor already fetches each restaurant's own website via `urls.official`. Add cuisine to the same extraction — it costs no additional TripAdvisor entities.

In `scripts/extract-capacity.ts`, extend the Zod schema:

```ts
const ExtractionSchema = z.object({
  rooms: z.array(RoomSchema),
  cuisine: z
    .string()
    .nullable()
    .describe(
      "The restaurant's primary cuisine as stated on the page (e.g. Italian, Japanese, Steakhouse). Null if the page does not say."
    ),
});
```

and add `cuisine` to the `venue_capacity` upsert. Add the column in a new migration `supabase/migrations/0004_capacity_cuisine.sql`:

```sql
alter table public.venue_capacity
  add column if not exists cuisine text;
```

Extend the extraction prompt with one sentence: *"Also record the restaurant's primary cuisine exactly as the page states it; use null if the page does not say."* Do not infer cuisine from the restaurant's name.

**Do not run the migration.** Write it; the owner runs it.

- [ ] **Step 3: Update the README**

Read the README first — the owner rewrote it and edits it concurrently. Preserve their structure and table formatting; edit in place. Update these places, all of which now describe the wrong API or deleted code:

1. The Commands table — remove any row for a deleted script; ensure `npm test`, `node scripts/match-overlay.mjs`, and `npm run extract-capacity` are listed.
2. `### Editing venue data` — `src/data/venues.json` is deleted; the source of truth is `src/data/overlay.json`.
3. `### Refreshing from Yelp` — replace with a Tripadvisor Terra section: base `https://terra.tripadvisor.com/api`, `X-API-Key` header, `TRIPADVISOR_API_KEY` in `.env.local`, and the billing model — **each location returned is a billable entity, 1,000 free once per account, then usage-based**. Say plainly that the legacy Content API sunsets 2026-08-31.
4. The Supabase setup steps — `0002_seed.sql` is deleted; the sequence is `0001_schema.sql`, then `0003_live_venues.sql`, then `0004_capacity_cuisine.sql`.
5. The blockquote warning about `truncate public.venues cascade` — that table is dropped.
6. The offline-fallback paragraph — the "Demo data · database offline" chip is gone; the app shows a live-data notice and falls back to curated overlay venues only when Tripadvisor is unreachable.

Also update the "Result data per venue" bullet to say "Tripadvisor rating" and note that results cap at 10, and drop the "Live data: Google Places / Yelp Fusion APIs" item from "With more time" — it is done.

- [ ] **Step 4: Verify and commit**

```bash
npm test && npx eslint && npm run build
```

```bash
git add scripts/match-overlay.mjs scripts/extract-capacity.ts supabase/migrations/0004_capacity_cuisine.sql README.md
git commit -m "feat: point the scripts at Terra, extract cuisine, update the README"
```

---

### Task 21: Private-dining enrichment — path probing, then domain-restricted search

TripAdvisor supplies no private-dining data at all. Today the extractor reads only the
restaurant's own site via `urls.official`, and gives up when that site has no obvious events
page. This task widens the net in two stages, cheapest first.

**Files:**
- Modify: `scripts/extract-capacity.ts`
- Modify: `src/lib/capacity-guard.ts` (a source-ranking helper only — do **not** touch
  `acceptRoomBlock`, which took three fix rounds to get right)

**Interfaces:**
- Consumes: `acceptRoomBlock`, `confidenceFor` (unchanged)
- Produces: `confidenceForSource(source, rooms)` — see Step 3

- [ ] **Step 1: Probe the obvious paths on the restaurant's own domain (free)**

When the homepage yields no events link, try the conventional paths directly before doing
anything that costs money:

```ts
const EVENT_PATHS = [
  "/private-dining",
  "/private-events",
  "/events",
  "/parties",
  "/banquets",
  "/groups",
  "/group-dining",
];

/** Cheapest source of truth: the restaurant's own site, guessed by convention. */
async function probeEventPaths(homepage: string): Promise<string | null> {
  const origin = new URL(homepage).origin;
  for (const path of EVENT_PATHS) {
    const url = `${origin}${path}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "user-agent": "PrivateDiningFinder/1.0 (+research tool)" },
        redirect: "follow",
      });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
        return res.url;
      }
    } catch {
      // Unreachable path — try the next.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
```

Call it only after the existing homepage-link search fails.

- [ ] **Step 2: Domain-restricted web search as the last resort**

Only when both the homepage link and the path probes come up empty. Use Anthropic's server-side
web search inside the same Claude call, restricted to sources that actually carry capacity data:

```ts
const ENRICHMENT_DOMAINS = [
  "opentable.com",
  "partyslate.com",
  "eventup.com",
  "tripleseat.com",
];

const searchTool = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
  max_uses: 3,
  allowed_domains: [...ENRICHMENT_DOMAINS, new URL(homepage).hostname],
};
```

Restricting the domains is the point: unrestricted search returns listicles that name a chain
without saying which branch, which is precisely the attribution failure the location guard
exists to catch.

**Verify compatibility before relying on it.** Structured outputs (`output_config.format`) and
server tools that emit citations may not compose — the API rejects `output_config.format`
alongside citations. Try the single call first; if the API rejects it, fall back to two calls:
one search call that returns prose, then a second `messages.parse()` extraction over that prose.
Report which shape actually worked, with the error if the first failed.

- [ ] **Step 3: Rank confidence by source**

A branch-specific OpenTable page stating a number is far stronger evidence than a blog. Add to
`src/lib/capacity-guard.ts` — a new function, leaving `acceptRoomBlock` untouched:

```ts
export type CapacitySource = "own-site" | "directory" | "search";

/**
 * Extracted capacity is only as trustworthy as where it came from. The
 * restaurant's own site and a branch-specific directory listing with real
 * numbers earn "likely"; anything else stays "unverified" and the card tells
 * the planner to call. Search results are the weakest source and never
 * upgrade a venue on their own.
 */
export function confidenceForSource(
  source: CapacitySource,
  rooms: { seated: number | null; standing: number | null }[]
): "likely" | "unverified" {
  const hasNumber = rooms.some((r) => r.seated !== null || r.standing !== null);
  if (!hasNumber) return "unverified";
  return source === "search" ? "unverified" : "likely";
}
```

Thread the source through the extractor and use it in place of the bare `confidenceFor` when
writing to `venue_capacity`. Always store the `source_url` actually used.

- [ ] **Step 4: The location guard still applies, and matters more here**

Every extracted block continues through `acceptRoomBlock`. This is not optional and not
duplicated effort: a single OpenTable search for "Havana Central Times Square private dining"
returns the Roosevelt Field Mall and Ridge Hill branches alongside the right one, each with its
own rooms and capacities. Attributing another branch's rooms is the exact failure this whole
guard exists to prevent.

When the source is a branch-specific URL, pass the branch identifier from the slug as the
block's `location_match` so the guard can act on it.

- [ ] **Step 5: Verify on a real venue**

Run the extractor against the TripAdvisor location id for **Havana Central Times Square**, which
is known to have OpenTable private-dining data (a mezzanine for up to 100, plus a Glass Room and
VIP Space for 20–30).

Report verbatim: which source tier produced the data, the rooms extracted with their capacities,
the confidence assigned, how many blocks the location guard rejected, and — critically — whether
any Roosevelt Field Mall or Ridge Hill room made it through. A room from another branch
appearing in the output is a failure, not a partial success.

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-capacity.ts src/lib/capacity-guard.ts src/lib/capacity-guard.test.ts
git commit -m "feat: probe event pages, then domain-restricted search, for private dining"
```

---

## Verification checklist

- [ ] `npm test`, `npm run build`, `npx eslint` all clean
- [ ] A real search returns up to 10 restaurants, all genuinely restaurants
- [ ] Each card shows Tripadvisor's own bubble image and a working listing link
- [ ] Photos appear for venues that have them
- [ ] `git grep -i "api.content.tripadvisor"` returns nothing outside the spec's history
- [ ] No code path calls `/locations/{id}/reviews`
- [ ] Entity spend for one cold search is measured and recorded
