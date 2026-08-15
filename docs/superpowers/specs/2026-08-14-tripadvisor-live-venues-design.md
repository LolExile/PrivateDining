# Private Dining Finder — Live TripAdvisor Venues

**Date:** 2026-08-14
**Status:** Design, awaiting review
**Supersedes:** the Yelp enrichment pipeline (`scripts/enrich-yelp.mjs`) and the seeded venue catalog

## 1. Problem

Today the app ships a hand-curated catalog of 38 venues. `src/data/venues.json` is written by
hand, compiled into `supabase/migrations/0002_seed.sql` by `scripts/generate-seed.mjs`, and loaded
at runtime from the `venues` + `private_rooms` tables, with the same JSON bundled as an offline
fallback. The catalog therefore exists in three places, all copies of one another, and it only
covers three cities.

Two changes are wanted:

1. Replace Yelp with TripAdvisor as the source of public restaurant signals (rating, review count,
   price tier, phone, listing link). TripAdvisor's Content API key is free.
2. Stop shipping a venue catalog. Populate the map from TripAdvisor at search time, and persist
   only what a user acts on.

The obstacle is that **TripAdvisor has no private-dining data** — no rooms, no seated or standing
capacities, no minimum spend, no group-sales contact. Those fields carry 35 of the 100 ranking
points in `src/lib/ranking.ts` — capacity 25, private rooms 10. A purely live catalog would strip
the app of the thing that makes it a private-dining finder.

## 2. Goals

- Replace the Yelp enrichment script with TripAdvisor as the public-signal source.
- Serve venues live per search instead of from a seeded catalog; drop the `venues` and
  `private_rooms` tables.
- Preserve capacity-aware ranking by combining three sources of private-dining data: a curated
  overlay, machine extraction from restaurants' own websites, and an honest "unknown".
- Persist a venue only when a user saves or books a plan, as a self-contained snapshot.
- Meet TripAdvisor's display requirements (logo, listing link, their bubble-rating image).
- Cap the result list at 20.

## 3. Non-goals

- Real reservations. "Book" remains a planning record; the app contacts nobody.
- Replacing curated capacity data with extraction. Extraction supplements it; it never overwrites
  a curated venue.
- Photo ingestion from TripAdvisor. Photos are a third endpoint with their own licensing terms;
  existing curated images stay.
- Routing-API commute times. The haversine estimate in `src/lib/geo.ts` is unchanged.

## 4. Constraints discovered during research

These shaped the design and are worth stating plainly, because several are permanent properties of
the free tier rather than things better code can work around.

| Constraint | Source | Consequence |
|---|---|---|
| `nearby_search` and `location/search` return **at most 10 results**, no pagination | [nearby search](https://tripadvisor-content-api.readme.io/reference/searchfornearbylocations), [search](https://tripadvisor-content-api.readme.io/reference/searchforlocations) | Must fan out across multiple search points to fill a map |
| Search results carry only `location_id`, `name`, `distance`, `bearing`, `address_obj` | same | Rating/price/phone need a `/details` call per venue |
| 5,000 calls/month free; **credit card required at signup** | [pricing](https://elfsight.com/blog/how-to-get-tripadvisor-api-key/) | Caching is not optional |
| Key must be restricted to an **IPv4 address or domain** before it is issued | same | Server-side only; local runs need the machine's public IP allowlisted |
| Display requirements: TripAdvisor logo (≥20px), link back to the listing, and **their** bubble-rating image — "do not use your own rating icons" | [display requirements](https://tripadvisor-content-api.readme.io/reference/display-requirements) | The hand-rolled star bar in `Badges.tsx` cannot be the primary rating display |
| No documented statement on caching or retention duration | same page | Our cache TTL is a judgment call, not a documented allowance |
| No free API anywhere returns private-room capacity | Tripleseat (per-venue only), PartySlate/EventUp (none), [OpenTable (partner-gated)](https://stayapi.com/blog/opentable-partner-api) | Capacity must be curated, extracted, or unknown |

The key currently returns `403 — "explicit deny in an identity-based policy"`, which is the
response when no IP restriction covers the caller. Nothing here runs until that is set.

## 5. Architecture

```
search (address, headcount, commute limit, mode, style, cuisine, dietary)
  │
  ├─ /api/geocode                    (unchanged) → lat/lng
  │
  └─ /api/venues/search              [NEW, server-only — holds the TA key]
       │
       ├─ radiusKm = limitMinutes × SPEED_KMH[mode] ÷ (ROUTE_FACTOR × 60)
       │  clamped to SEARCH_RADIUS_MILES (20 mi), inverting geo.ts's commuteMinutes
       │
       ├─ fan out: centre + 5 ring points at 0.6 × radiusKm
       │     GET /location/nearby_search?latLong&category=restaurants&radius&radiusUnit=km
       │     → dedupe by location_id                                    (~6 calls)
       │
       ├─ union in: every overlay venue whose coords fall inside radiusKm
       │     (guarantees curated venues can never be crowded out by the 10-result cap)
       │
       ├─ keep the ~30 nearest unique ids
       │     GET /location/{id}/details for each                        (~30 calls)
       │
       ├─ merge:  live details  +  curated overlay  +  capacity cache
       │
       └─ → Venue[] in the existing shape
            │
            └─ rankVenues() → MapPanel / VenueCard  (unchanged consumers)
```

The route must be server-side: the API key is IP-restricted, so the browser can never call
TripAdvisor directly.

**The union step is load-bearing.** With only 10 results per search point, TripAdvisor will
routinely fail to return the venues that actually have capacity data. Any overlay venue inside the
radius has its `/details` fetched directly by its known `location_id` and is merged into the
candidate set regardless of whether search surfaced it.

## 6. Data sources and precedence

Each venue is assembled from up to three sources. Later rows win only for the fields they own;
they never overwrite a field owned by an earlier row.

| Source | Owns | Trust label |
|---|---|---|
| TripAdvisor `/details` | `name`, `address`, `lat`/`lng`, `rating`, `review_count`, `price_tier`, `contact.phone`, `menu_url` (from `website`), `ta_url`, `ta_rating_image_url`, `cuisine` | — |
| `src/data/overlay.json` (curated) | `rooms`, `contact`, `event_styles`, `dietary`, `menu_highlights`, `description` | `verified` |
| `venue_capacity` table (extracted) | `rooms`, `capacity_source_url` — **only when no overlay entry exists** | `likely` |
| neither | `rooms: []` | `unverified` → renders as "needs a call" |

**Price is TripAdvisor's `price_level` tier and nothing else.** The curated
minimum spend and its separate `price_trust` label are both dropped: with every
venue's price coming from the same source, a per-venue price-trust label would
read identically on every card, and a minimum spend extracted from a marketing
page was the least reliable field in the extraction. `Venue.min_spend` and
`Venue.price_trust` are removed from the type; the price factor scores on
whether a tier is known.

This maps onto the trust model already in the app rather than bolting a new concept on: a live
listing with unknown capacity genuinely *is* "needs a call".

### 6.1 The curated overlay

`src/data/venues.json` becomes `src/data/overlay.json`, keyed by `ta_location_id`, and shrinks to
only the fields TripAdvisor cannot supply (the "owns" column above). Name, address, coordinates,
rating, review count, price tier, phone, cuisine, and listing URL stop being maintained by hand.

`scripts/match-overlay.mjs` is a one-time helper that searches TripAdvisor by name + coordinates
for each of the 38 curated venues and writes the matched `location_id` and matched name into the
overlay for human review. Matches are not trusted until reviewed — an unreviewed entry is written
with `ta_location_id: null` and a `_match_candidate` field.

### 6.2 The capacity extractor

`scripts/extract-capacity.mjs` runs as a background job over `location_id`s the app has seen and
has no overlay entry for. Per venue:

1. Read `website` from the cached `/details` response.
2. Fetch that page; follow at most one same-host link whose text or href matches
   `/private|events|parties|group|banquet/i`. Respect `robots.txt`; one request per host per
   second; abandon the venue on any non-200.
3. Extract with `client.messages.parse()` against a Zod schema — rooms (`name`, `seated`,
   `standing`, `notes`) and a `location_match` field naming the city/address the page
   attributes each room block to.
4. **Discard any room block whose `location_match` does not match the venue's city or street.**
5. Write to `venue_capacity` with `source_url` and `extracted_at`.

Model: `claude-opus-5`. At roughly 10k input tokens per page, extraction costs about $0.06/venue —
~$2.30 for the current 38 — and the failure mode being guarded against (multi-city restaurant
groups) is exactly the judgment a cheaper model is most likely to get wrong. Cost is not the
binding constraint at this volume.

**Known yield limits, from testing the approach against carminesnyc.com:** many rooms are named
without any stated capacity, and restaurant groups publish one shared events page covering every
city. The Carmine's page names rooms in Times Square, the Upper West Side, Atlantic City, D.C., and
Las Vegas together; without step 4, D.C.'s eight rooms would be attributed to the Times Square
venue. Expect usable room data for roughly half to two-thirds of venues, and reliable numeric
capacities for fewer. A room extracted without a number is stored with `seated: null` and rendered
as "private room, capacity unconfirmed" — visibly unknown rather than silently guessed.

## 7. Caching and call budget

| Cache | Key | TTL |
|---|---|---|
| `/details` | `location_id` | 24h, via Next's `fetch` revalidation |
| `nearby_search` | grid point rounded to 3 decimal places + radius | 24h |
| `venue_capacity` | `ta_location_id` | 30 days, then re-extract |

A cold search costs ~36 calls (6 search + 30 details); a warm one costs 0. Against 5,000/month
that is ~140 cold searches, and the three demo scenarios are free after their first run.

The 24h TTL is a judgment call. TripAdvisor's display requirements cover logo, bubble images,
review quotes, and ranking claims, and say nothing about caching duration. If a more conservative
posture is wanted, 1h is a one-line change that costs roughly 12× the call volume.

## 8. Database changes

`supabase/migrations/0003_live_venues.sql`:

1. **Add snapshot columns to `reservations`** — `venue_name`, `venue_address`, `venue_lat`,
   `venue_lng`, `venue_ta_id`, `venue_ta_url`, `venue_rating`, `venue_image_url`.
2. **Backfill them** from the `venues` table for existing rows, *before* dropping anything, so
   already-saved plans survive.
3. **Drop the `venue_id` foreign key**, keeping `venue_ta_id` as an unenforced reference.
4. **Drop `private_rooms`, then `venues`.**
5. **Create `venue_capacity`** — `ta_location_id text primary key`, `rooms jsonb not null default
   '[]'`, `source_url text`, `confidence text check (confidence in
   ('likely','unverified'))`, `extracted_at timestamptz not null default now()`. RLS: readable by
   `anon`; writes restricted to the service role, since only the extractor writes.

   `confidence` is `likely` when extraction found at least one numeric capacity, and `unverified`
   when it found only room names — a venue we know has private space but cannot size. Both map to
   the trust label of the same name in §6.

`attendees` and `reservation_attendees` are untouched.

Note on scope: `venue_capacity` is a table, which sits against the "don't store restaurants in the
DB" instruction. It stores no listing data — no names, addresses, ratings, or links — only derived
private-dining facts that exist nowhere else and cost real money to re-derive. The catalog tables
still go away. It has to be a table rather than a committed JSON file because it must grow at
runtime as users search new cities.

## 9. Type changes

`Room.seated` and `Room.standing` become `number | null` to represent a room found without a stated
capacity. This ripples into two functions in `src/lib/ranking.ts`:

- `relevantCapacity()` returns `null` for an unknown-capacity room.
- `pickBestRoom()` ignores unknown-capacity rooms when looking for a fit, but still reports them in
  the card's room list.

A venue whose only rooms have unknown capacity scores as capacity-unknown (partial credit,
`0.5 × WEIGHTS.capacity`), not capacity-zero — it plausibly fits, it just hasn't been confirmed.
**A venue with no rooms at all scores the same way**, for the same reason: `rooms: []` means we
have no capacity data, not that the venue holds nobody. This is the normal state of every
live-only TripAdvisor venue, so treating it as a known zero would sink the majority of results.
The separate private-rooms factor (weight 10) already carries the "no private spaces listed"
penalty; the capacity factor must not double-count it on a fact we do not have.

`RankedVenue` therefore also carries `capacityKnown: boolean` and `bestCapacity: number | null`,
so the card renders from the values the ranker computed rather than re-deriving "is this
confirmed?" from raw nulls — a duplicate derivation that drifts from `relevantCapacity`'s
event-style awareness and renders "fits 0" beside a "capacity unconfirmed" ledger line.

`Venue` gains `ta_location_id`, `ta_url`, `ta_rating_image_url`, and `capacity_source_url`, all
nullable, and loses `min_spend` and `price_trust` per §6. `PriceSignal` in `Badges.tsx` and the
price factor in `ranking.ts` both read the tier alone.

## 10. Attribution

- `Stars` in `src/components/Badges.tsx` renders `<img src={venue.ta_rating_image_url}>` when
  present, falling back to the existing gold star bar when null (offline data, or an unmatched
  venue). Plain `<img>` throughout the app already, so no `next.config.ts` change is needed.
- Each card in `src/components/VenueCard.tsx` carries a TripAdvisor logo (local SVG in `public/`,
  ≥20px high) linking to `ta_url`.
- Extracted capacity shows "capacity from the restaurant's site" linking to `capacity_source_url`,
  so a planner can verify in one click.

## 11. Ranking, the top-20 target, and unconfirmed dietary

**Any address the user enters must return up to 20 live venues that meet their stated
criteria.** The app must not fall back to a static catalog to fill the list.

Two things in the original design defeated that, both found by tracing a real search:

**Dietary was a hard exclusion.** `ranking.ts` drops any venue whose `dietary` array lacks a
requested tag. TripAdvisor has no dietary field at all — the Content API's location response
carries `cuisine`, `features`, and `price_level`, but no `dietary_restrictions` — so
`mergeVenue` gives every live-only venue `dietary: []`. Ticking any dietary box would
therefore have excluded every live venue and returned an empty list, permanently.

The fix mirrors the capacity rule in §9: **unknown is unconfirmed, not disqualified.**
- A venue with a **known** dietary list that lacks a requested tag is still excluded — curated
  data is trustworthy, and excluding on it is the user's intent.
- A venue with **no** dietary data is kept, its unmet requests recorded in `dietaryMissing`,
  and the card shows "dietary unconfirmed — confirm by phone".
- `excludedByDietary` continues to count only genuine exclusions.

**The candidate pool was too small to yield 20.** Six search points, deduped, capped at 30
candidates, then filtered by radius and commute, routinely leaves well under 20. The grid
becomes two rings (centre + 6 at 0.5 × radius + 6 at 0.85 × radius = 13 points) and the
candidate cap rises to 45. Cold-search cost goes from ~36 calls to ~58; against the free
5,000/month that is ~86 cold searches a month, and repeat searches are free for 24h.

Honesty still outranks the target: a 15-minute walk from a rural address may simply not
contain 20 restaurants. The list shows what genuinely qualifies and states the count — it is
never padded with venues that violate the commute limit.

## 12. Failure modes

| Failure | Behavior |
|---|---|
| TripAdvisor 403 (IP allowlist) | Serve overlay venues only; chip reads "TripAdvisor key not authorized — check the IP allowlist" |
| TripAdvisor 429 | Exponential backoff, serve partial results, chip reads "partial results" |
| Monthly quota exhausted | Serve overlay venues only; chip reads "live data unavailable" |
| Individual `/details` fails | Include the venue with null rating/price rather than dropping the pin |
| Supabase unreachable | Search works; saving a plan fails with an explicit message |
| Extraction job fails for a venue | No row written; venue renders as "needs a call" |

The overlay-only path matters for the demo: the three challenge scenarios stay reliable on
conference wifi, or from any machine whose IP is not on the allowlist.

## 13. Testing

There is no test infrastructure in the repo today. This adds **vitest** and unit tests for the
three pure functions where the bugs will be, none of which touch the network:

- `mergeVenue(live, overlay, capacity)` — precedence rules from §6, including that an overlay entry
  suppresses an extracted one.
- `searchGrid(lat, lng, radiusKm)` — point count, spacing, and the 20-mile clamp.
- `parsePriceLevel("$$ - $$$")` → `2..3`, and the null/garbage cases.
- `acceptRoomBlock(block, venue)` — the §6.2 step-4 city guard, using the real Carmine's data as a
  fixture.

Plus `npm run build` and `npx eslint`. Live behavior cannot be verified until the IP allowlist is
fixed; that verification is explicitly deferred and will be reported as unverified until it runs.

## 14. Build order

Each phase leaves the app working.

1. **TripAdvisor client + live search route.** `src/lib/tripadvisor.ts`, `/api/venues/search`,
   caching, the grid fan-out, `parsePriceLevel`. App still reads the seeded catalog.
2. **Overlay + merge.** `match-overlay.mjs`, `overlay.json`, `mergeVenue`, type changes. Search
   switches to the live route. Curated capacity preserved.
3. **DB migration.** Snapshot columns, backfill, drop catalog tables, `venue_capacity`.
   `reservations.ts` writes snapshots.
4. **Capacity extractor.** `extract-capacity.mjs`, the city guard, the cache read path.
5. **Attribution, top-20, copy.** Bubble images, logo, result cap, the explicit "no reservation was
   made" wording in `ReservationModal`, README rewrite.

## 15. Risks

- **The 10-result cap is permanent.** Map density will be modest regardless of implementation. The
  fan-out mitigates it; it does not remove it.
- **Extraction is the fragile piece.** Everything else fails loudly; a bad extraction produces
  plausible wrong numbers. Storing and displaying `source_url` is what makes that recoverable, and
  extracted data never reaches the `verified` label.
- **Cold start.** A city nobody has searched shows every venue as "needs a call" until the
  extractor runs over it. Capacity fills in on a delay.
- **Key friction.** Credit card at signup, and the IP allowlist breaks whenever the developer's
  public IP changes.
- **The Content API has a successor.** TripAdvisor is moving to
  [Terra](https://docs.terra.tripadvisor.com/docs/overview). The Content API is what is live and
  free today; this design will need revisiting when it is retired.
