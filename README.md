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
(minimum spend or price tier, carrying its own separate trust label), star rating, cuisine,
dietary accommodations, menu link with sample dishes, and contact information.

**Map** — a right-hand pane with rank-numbered markers kept in sync with the result list.

**Dinner plans** — pick a venue and add attendees with name, email, phone, and dietary notes.
Attendee profiles are stored in Supabase and deduplicated by email, so the same guests can be
pulled into the next dinner. Saved plans are browsable under "Saved plans".

**Offline resilience** — if the Supabase tables are missing or unreachable, the app serves the
same venue dataset from a bundled copy and displays a "Demo data · database offline" chip.
Search, ranking, and the map keep working; saving plans requires the database.

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
| `node scripts/generate-seed.mjs` | Regenerate `supabase/migrations/0002_seed.sql` from `src/data/venues.json` |
| `node scripts/enrich-yelp.mjs` | Refresh venue data from the Yelp Fusion API, then regenerate the seed SQL |

### Editing venue data

`src/data/venues.json` is the single source of truth — it powers both the seeded database and
the offline fallback. After editing it, run `node scripts/generate-seed.mjs` to regenerate the
seed SQL, then re-run `supabase/migrations/0002_seed.sql` in the SQL Editor to push the change
to the database.

### Refreshing from Yelp

`scripts/enrich-yelp.mjs` pulls live ratings, review counts, price tiers, phone numbers, and
photos for every venue. It reads a [Yelp Fusion API key](https://www.yelp.com/developers) from
`.env.local` as `YELP_API_KEY=...`. Curated private-room capacities are preserved — Yelp
carries no private-dining data, so enrichment refreshes only the public signals and upgrades
the trust label on matched listings. Re-run `0002_seed.sql` afterward to apply the new data.

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
| `venues` | Venue listing: location, cuisine, rating, price signal and trust, dietary, menu, contact |
| `private_rooms` | Each room or space with its seated and standing capacity |
| `attendees` | Saved guest profiles (name, email, phone, dietary notes), deduplicated by email |
| `reservations` | A planned dinner: venue, date, headcount, and the search context |
| `reservation_attendees` | Join table linking plans to attendee profiles |

Row Level Security is enabled on all five tables. Venue data is read-only to the publishable
key; the planning tables allow read and write. There is no auth by design — this is an
internal planner tool.

The SQL that produced this database lives in `supabase/migrations/` (`0001_schema.sql` for the
tables, indexes, and RLS policies; `0002_seed.sql` for the 38 venues and 72 rooms). It has
already been applied to the hosted project — the files are kept for reference and for
regenerating seed data, not as a setup step.

## With more time

- Live data: Google Places / Yelp Fusion for real-time ratings, photos, and hours, plus a
  routing API such as OSRM or Mapbox for true commute times instead of estimates.
- Authentication and per-planner workspaces, so RLS can scope plans to their owner.
- Outreach: draft inquiry emails to venue contacts directly from a saved plan.
- Room-level availability calendars and RFP status tracking per venue.
