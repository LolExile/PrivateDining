// Enriches src/data/venues.json with live Yelp data (rating, review count,
// price tier, phone, photo, menu/yelp URL) via the Yelp Fusion API, then
// regenerates the seed SQL. Curated private-room and capacity data is kept —
// Yelp has no private-dining data; it only refreshes the public signals.
//
// Usage:
//   1. Get a free API key: https://www.yelp.com/developers (create an app)
//   2. Add YELP_API_KEY=... to .env.local (or pass as env var)
//   3. node scripts/enrich-yelp.mjs
//   4. Re-run supabase/migrations/0002_seed.sql in the Supabase SQL editor
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvKey() {
  if (process.env.YELP_API_KEY) return process.env.YELP_API_KEY;
  const envPath = join(root, ".env.local");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(/^YELP_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  return null;
}

const API_KEY = loadEnvKey();
if (!API_KEY) {
  console.error(
    "Missing YELP_API_KEY. Get a free key at https://www.yelp.com/developers and add YELP_API_KEY=... to .env.local"
  );
  process.exit(1);
}

const venuesPath = join(root, "src", "data", "venues.json");
const venues = JSON.parse(readFileSync(venuesPath, "utf8"));

const PRICE_TIERS = { $: 1, $$: 2, $$$: 3, $$$$: 4 };

async function yelp(path, params) {
  const url = new URL(`https://api.yelp.com/v3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (res.status === 429) {
    // basic rate-limit backoff
    await new Promise((r) => setTimeout(r, 2000));
    return yelp(path, params);
  }
  if (!res.ok) throw new Error(`Yelp ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

let enriched = 0;
let missed = 0;

for (const venue of venues) {
  try {
    // Search by name near the venue's known coordinates for a reliable match.
    const data = await yelp("/businesses/search", {
      term: venue.name,
      latitude: venue.lat,
      longitude: venue.lng,
      radius: 1200,
      limit: 3,
      sort_by: "best_match",
    });
    const hit = data.businesses?.[0];
    if (!hit) {
      console.warn(`  no match: ${venue.name}`);
      missed++;
      continue;
    }
    venue.rating = hit.rating ?? venue.rating;
    venue.review_count = hit.review_count ?? venue.review_count;
    if (hit.price) venue.price_tier = PRICE_TIERS[hit.price] ?? venue.price_tier;
    if (hit.display_phone) venue.contact.phone = hit.display_phone;
    if (hit.image_url) venue.image_url = hit.image_url;
    if (hit.url) venue.menu_url = hit.url; // Yelp page links to menus/photos
    if (hit.coordinates?.latitude) venue.lat = hit.coordinates.latitude;
    if (hit.coordinates?.longitude) venue.lng = hit.coordinates.longitude;
    // Live-confirmed listing: upgrade unverified listings to "likely".
    if (venue.trust_label === "unverified") venue.trust_label = "likely";
    enriched++;
    console.log(`  ✓ ${venue.name} — ${hit.rating}★ (${hit.review_count} reviews)`);
    await new Promise((r) => setTimeout(r, 250)); // stay well under rate limits
  } catch (e) {
    console.warn(`  error for ${venue.name}: ${e.message}`);
    missed++;
  }
}

writeFileSync(venuesPath, JSON.stringify(venues, null, 2) + "\n");
console.log(`\nEnriched ${enriched}/${venues.length} venues (${missed} missed).`);

execFileSync(process.execPath, [join(root, "scripts", "generate-seed.mjs")], {
  stdio: "inherit",
});
console.log("Seed SQL regenerated — re-run it in the Supabase SQL editor to update the DB.");
