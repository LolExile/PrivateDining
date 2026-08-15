// Extracts private-dining room capacities — and, alongside them, primary
// cuisine — from restaurants' own websites for Tripadvisor locations that have
// no curated overlay entry, and caches the result in public.venue_capacity.
//
// Terra has no private-dining data and no cuisine field, so this is the only
// way to populate either for venues outside the curated overlay. Extracted
// data is never "verified" — see the trust rules in the spec.
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
import { locationDetails } from "../src/lib/tripadvisor";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(name: string): string | null {
  if (process.env[name]) return process.env[name] as string;
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
] as const) {
  if (!value) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
}
// locationDetails() (src/lib/tripadvisor.ts) reads TRIPADVISOR_API_KEY straight
// from process.env — it has no .env.local fallback of its own — so make sure a
// key sourced from .env.local above is actually visible to it.
process.env.TRIPADVISOR_API_KEY = TA_KEY!;

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
  cuisine: z
    .string()
    .nullable()
    .describe(
      "The restaurant's primary cuisine as stated on the page (e.g. Italian, Japanese, Steakhouse). Null if the page does not say."
    ),
});

/** Fetch a page and reduce it to text; abandon anything that is not 200 HTML. */
async function fetchText(url: string): Promise<string | null> {
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
async function findEventsPage(homepage: string): Promise<string | null> {
  const res = await fetch(homepage, {
    headers: { "user-agent": "PrivateDiningFinder/1.0 (+research tool)" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const origin = new URL(homepage).origin;
  const links = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const hit = links.find((h) => /private|events|parties|group|banquet/i.test(h));
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

Record only what the page states. Never infer or estimate a capacity: if no number is given, use null.

Also record the restaurant's primary cuisine exactly as the page states it; use null if the page does not say.`;

for (const id of ids) {
  try {
    const d = await locationDetails(id);
    if (!d) {
      console.warn(`  ${id}: no details returned`);
      continue;
    }
    const homepage = d.website;
    if (!homepage) {
      console.warn(`  ${id}: no website on the Tripadvisor listing`);
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
      messages: [{ role: "user", content: `${EXTRACTION_PROMPT}\n\n---\n\n${text}` }],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      console.warn(`  ${id}: extraction returned nothing`);
      continue;
    }

    const venue = {
      // Terra's own /locations/{id} details carry no city field, only a street
      // address; the overlay is the only other source, and it rarely has an
      // entry for the ids this script targets (it exists precisely for venues
      // *outside* the overlay). An unknown city makes the guard fail closed —
      // any room block that names a location gets rejected rather than risking
      // a misattributed capacity, which matches how it already treats missing
      // signal everywhere else.
      city: overlay.get(String(id))?.city ?? "",
      address: d.street_address ?? "",
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
        name,
        seated,
        standing,
        notes,
      })),
      cuisine: parsed.cuisine,
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
    console.warn(`  ${id}: ${(e as Error).message}`);
  }
  // One request per host per second is polite; these are small sites.
  await new Promise((r) => setTimeout(r, 1000));
}
