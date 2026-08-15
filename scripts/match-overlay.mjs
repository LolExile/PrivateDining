// Builds src/data/overlay.json from the legacy src/data/venues.json by matching
// each curated venue to a Tripadvisor location_id, keeping ONLY the fields
// Tripadvisor cannot supply (rooms, contact, dietary, menu notes).
//
// Matches are written with a _match_candidate field for human review. An entry
// whose match you have not confirmed keeps ta_location_id: null and is ignored
// at runtime.
//
// Usage:
//   1. TRIPADVISOR_API_KEY=... in .env.local (Terra key, no IP/domain allowlist)
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

const KEY = loadKey();
if (!KEY) {
  console.warn(
    "No TRIPADVISOR_API_KEY found — transforming src/data/venues.json only.\n" +
      "Every entry will be written with ta_location_id: null and no _match_candidate.\n" +
      "Get a Terra key at https://www.tripadvisor.com/developers, put it in\n" +
      ".env.local, and re-run to populate matches.\n"
  );
}

const venues = JSON.parse(
  readFileSync(join(root, "src", "data", "venues.json"), "utf8")
);

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
    await new Promise((r) => setTimeout(r, 250));
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
