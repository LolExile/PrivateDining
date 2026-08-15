# Private Dining Finder

A research and recommendation tool for event planners. You enter an address, a headcount, and
a commute limit; the app returns a ranked, explainable list of restaurants with private dining
rooms that can actually host the event, shown as a split-pane list and map. Once you pick a
venue you can build a dinner plan on it — add attendees with their contact details and dietary
notes, and the plan and guest profiles are saved for reuse.

The core idea is **explainability**: every result shows a "fit ledger" describing exactly why
it ranked where it did, and every fact carries a trust label so a planner knows what still
needs confirming by phone before committing.

Built for the Nowadays challenge.

## Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| Maps | Leaflet + React-Leaflet, OpenStreetMap tiles |
| Geocoding | Nominatim (OpenStreetMap), with a built-in landmark fallback table |

## Features

**Search** — address or landmark, headcount, max commute time, commute mode (walking or
driving), and event style (seated dinner or happy-hour reception). Additional filters narrow
by cuisine type and dietary needs: vegetarian, vegan, gluten-free, nut allergy, and
kosher-on-request. Three one-click scenario shortcuts are built in: 50 people near Times
Square, 30 people near Salesforce Tower in San Francisco, and a 200-person reception near
Hilton Hawaiian Village in Waikiki.

**Ranking** — results are ordered by best overall fit, weighted in this order: cuisine match
(when one is chosen) → capacity fit for the headcount → commute → private-room availability →
price signal → trust label. Every card shows the ledger of how that venue scored on each
factor, so a ranking is never a black box.

**Venue detail** — name, address, photo, private rooms with seated and standing capacities,
distance and commute time, trust label (verified / likely / needs a call), price signal
(minimum spend or price tier, carrying its own separate trust label), Tripadvisor rating,
cuisine, dietary accommodations, menu link with sample dishes, and contact information. Results
are capped at 10 venues per search.

**Map** — a right-hand pane with rank-numbered markers kept in sync with the result list.

**Dinner plans** — pick a venue and add attendees with name, email, phone, and dietary notes.
Attendee profiles are stored in Supabase and deduplicated by email, so the same guests can be
pulled into the next dinner. Saved plans are browsable under "Saved plans".

**Offline resilience** — if Tripadvisor is unreachable, the app falls back to the curated
overlay venues and shows a live-data notice explaining why. Search, ranking, and the map keep
working on the fallback set; saving plans still requires Supabase.

## Setup

Requires **Node.js 20 or newer**. That is the only prerequisite — the app connects to a hosted
Supabase database that is already created and seeded, and its credentials are committed in
`.env`. There is no account to make, no migration to run, and no environment file to write.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Search, ranking, the map, and dinner-plan
saving all work immediately.

> The committed `.env` contains a Supabase **publishable** key, which is designed to be sent to
> the browser; the secret key is not in this repository. Treat the shared database as demo-only:
> anything saved to it is readable by anyone with this repository, so please don't enter real
> attendees' contact details.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server on port 3000 |
| `npm run build` | Build for production |
| `npm start` | Serve the production build (run `npm run build` first) |
| `npm run lint` | Run ESLint |
| `npm test` | Run the automated test suite |
| `node scripts/match-overlay.mjs` | Match curated venues to Tripadvisor location ids and rebuild `src/data/overlay.json` |
| `npm run extract-capacity` | Extract private-dining capacity and cuisine from a venue's own website |

### Editing venue data

`src/data/overlay.json` is the single source of truth for curated private-dining data — rooms,
contact info, dietary notes, and menu highlights for the venues we've researched by hand.
Tripadvisor supplies everything else (name, address, rating, price signal, photo) live at
search time, so there is no seed table to regenerate. After editing `overlay.json`, run
`node scripts/match-overlay.mjs` to (re)match entries against Tripadvisor location ids; review
each `_match_candidate` before deleting it, since an unconfirmed match is ignored at runtime.

### Tripadvisor Terra

Live venue data — name, address, rating, price tier, and photo — is fetched at search time from
Tripadvisor's **Terra** API (base `https://terra.tripadvisor.com/api`), authenticated with an
`X-API-Key` header. Put your key in `.env.local` as `TRIPADVISOR_API_KEY=...`; there is no IP or
domain allowlist involved.

**Billing is per location returned** — every location in a response, whether from the nearby
search, a details call, or a photo call, is one billable entity. The account gets **1,000 free
locations once, for the lifetime of the account** (not a monthly allowance), after which usage
is billed. A single cold search costs roughly 100 billable locations, so budget accordingly
before running repeated searches or the extraction script over many venues.

Tripadvisor's legacy Content API (`api.content.tripadvisor.com`), which this app used before the
Terra migration, **sunsets on 2026-08-31**. Terra is the only supported path going forward.

## How it works

**Commute estimates** use haversine distance multiplied by a 1.3 urban routing factor, at
4.8 km/h walking or 28 km/h driving. The active mode and limit appear on every result, and a
20-mile hard radius bounds every search.

**Trust labels** (`verified` / `likely` / `unverified`, surfaced as "needs a call") attach
independently to the listing and to its price signal, because capacity data and pricing carry
genuinely different confidence levels in practice.

**Geocoding** runs through the `/api/geocode` route, which queries Nominatim/OpenStreetMap and
falls back to a built-in landmark table, so the three scenario addresses resolve even without
network access.

**Dataset** — venue data is curated from public sources for the three challenge markets.
Capacities, ratings, minimum spends, and contacts are approximations for demo purposes; the
trust labels model exactly that uncertainty.

## Database schema

| Table | Purpose |
| --- | --- |
| `venue_capacity` | Machine-extracted private-dining capacity and cuisine for venues outside the curated overlay, keyed by Tripadvisor location id |
| `attendees` | Saved guest profiles (name, email, phone, dietary notes), deduplicated by email |
| `reservations` | A planned dinner: a self-contained snapshot of the chosen venue, date, headcount, and the search context |
| `reservation_attendees` | Join table linking plans to attendee profiles |

Row Level Security is enabled on all four tables. `venue_capacity` is read-only to the
publishable key and written only by `scripts/extract-capacity.ts` under the service role; the
planning tables allow read and write. There is no auth by design — this is an internal planner
tool.

The SQL that produced this database lives in `supabase/migrations/` — `0001_schema.sql` for the
original tables, indexes, and RLS policies, `0003_live_venues.sql` for the move to live
Tripadvisor data (dropping the venue catalog in favor of `venue_capacity` and a self-contained
reservation snapshot), and `0004_capacity_cuisine.sql` for the extractor's cuisine column. All
three have already been applied to the hosted project — the files are kept for reference, not
as a setup step.

## With more time

- A routing API such as OSRM or Mapbox for true commute times, instead of the haversine
  estimate.
- Authentication and per-planner workspaces, so RLS can scope plans to their owner.
- Outreach: draft inquiry emails to venue contacts directly from a saved plan.
- Room-level availability calendars and RFP status tracking per venue.
