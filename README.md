# Private Dining Finder

A research and recommendation tool for event planners: enter an address, headcount, and
commute limit, and get a ranked, explainable list of private-dining venues on a split-pane
map interface. Built for the Nowadays challenge.

**Stack:** Next.js (App Router) · React · Tailwind CSS v4 · Supabase (PostgreSQL) · Leaflet/OpenStreetMap

## Features

- **Search** by address/landmark, headcount, max commute time, commute mode
  (walking or driving — the chosen mode is stated on every result), and event style
  (seated dinner vs. happy-hour/reception).
- **Optional filters:** cuisine type (ranked first when chosen) and dietary needs
  (vegetarian, vegan, gluten-free, nut allergy, kosher-on-request).
- **Ranking by best overall fit**, in this order of importance: cuisine match (when chosen) →
  capacity fit for the headcount → commute → private-room availability → price signal →
  trust label. Each card shows a "fit ledger" of how the venue scored on every factor.
- **Result data per venue:** name, address, photo, private rooms with seated/standing
  capacities, distance + commute time, trust label (verified / likely / needs a call),
  price signal (min spend or price tier, with its own trust label), Yelp-style star rating,
  cuisine, dietary accommodations, menu link + sample dishes, and contact info.
- **Map view** (right pane) with rank-numbered markers synced with the list.
- **Dinner plans:** choose a venue, add attendees (name, email, phone, dietary notes).
  Attendee profiles are saved to Supabase and reusable for the next dinner. Plans are
  browsable under "Saved plans".
- **Resilient:** if the Supabase tables haven't been created yet, the app serves the same
  venue dataset from a bundled fallback (a "database offline" chip appears; saving plans
  requires the database).

## Setup

### 1. Install and run

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + publishable key
npm run dev                  # http://localhost:3000
```

### 2. Create and seed the database

In your Supabase project's **SQL editor**, run the two files in order:

1. `supabase/migrations/0001_schema.sql` — tables, indexes, RLS policies
2. `supabase/migrations/0002_seed.sql` — 38 curated venues + private rooms

(Or with the Supabase CLI: `supabase db push`.)

The seed file is generated from `src/data/venues.json` — the single source of truth that
also powers the offline fallback. After editing the JSON, regenerate with:

```bash
node scripts/generate-seed.mjs
```

## The three challenge scenarios

One-click shortcuts are built into the search panel:

1. **50 people near Times Square, NY** — under 20 min commute
2. **30 people near Salesforce Tower (415 Mission St, SF)** — under 15 min commute
3. **200 people, happy hour / reception near Hilton Hawaiian Village, Waikiki** — under 15 min walk

## Design decisions

- **Commute estimates** use haversine distance × 1.3 urban route factor, at 4.8 km/h
  (walking) or 28 km/h (driving). The active mode and limit are always displayed. A 20-mile
  hard radius bounds every search.
- **Trust labels** (`verified` / `likely` / `unverified → "needs a call"`) attach to both
  the listing and its price signal independently, since capacity data and pricing have
  different confidence levels in reality.
- **Geocoding** runs through `/api/geocode` (Nominatim/OpenStreetMap with a landmark
  fallback table), so the three scenario addresses resolve even offline.
- **Dataset:** venue data is curated from public sources for the three challenge markets;
  capacities, ratings, minimums, and contacts are approximations for demo purposes — the
  trust labels model exactly this uncertainty.

## Database schema

| Table | Purpose |
| --- | --- |
| `venues` | Venue listing: location, cuisine, rating, price signal + trust, dietary, menu, contact |
| `private_rooms` | Each room/space with seated and standing capacity |
| `attendees` | Saved guest profiles (name, email, phone, dietary notes), deduped by email |
| `reservations` | A planned dinner: venue, date, headcount, search context |
| `reservation_attendees` | Join table linking plans to attendee profiles |

RLS is enabled on all tables: venue data is read-only to the publishable key; the planning
tables allow read/write (internal tool, no auth by design — see "With more time").

## With more time

- Live data: Google Places / Yelp Fusion APIs for real ratings, photos, and hours;
  a routing API (OSRM/Mapbox) for true commute times.
- Auth + per-planner workspaces, so RLS can scope plans to their owner.
- Outreach: draft inquiry emails to venue contacts straight from a plan.
- Room-level availability calendars and RFP status tracking per venue.
