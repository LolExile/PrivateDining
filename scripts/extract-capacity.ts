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
import {
  acceptRoomBlock,
  confidenceForSource,
  type CapacitySource,
  type ExtractedBlock,
} from "../src/lib/capacity-guard";
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

const MODEL = "claude-opus-5";

/** Conventional paths tried, in order, on the restaurant's own domain — free. */
const EVENT_PATHS = [
  "/private-dining",
  "/private-events",
  "/events",
  "/parties",
  "/banquets",
  "/groups",
  "/group-dining",
];

/**
 * Third-party directories that actually carry private-dining capacity data,
 * as opposed to general search which returns listicles naming a chain
 * without saying which branch. Domain-restricting the search tool to these
 * plus the venue's own hostname is the point: it keeps the metered search
 * stage from reintroducing the attribution failure the location guard exists
 * to catch (see capacity-guard.ts).
 */
const ENRICHMENT_DOMAINS = ["opentable.com", "partyslate.com", "eventup.com", "tripleseat.com"];

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

/** Same shape, plus the URL the search stage must self-report as its evidence. */
const SearchExtractionSchema = ExtractionSchema.extend({
  source_url: z
    .string()
    .nullable()
    .describe(
      "The exact URL, from among the search results, that stated the capacity numbers extracted above. Null if no single page stated a number."
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

/**
 * Cheapest source of truth after the homepage link: the restaurant's own
 * site, guessed by convention. Called only once the homepage-link search
 * (findEventsPage) has already come back empty — a free step before anything
 * that costs money.
 */
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

const EXTRACTION_PROMPT = `You are reading a restaurant's website. Extract every private dining room or event space it describes.

For each space, record its name, seated capacity, standing/reception capacity, any notes, and — critically — the city, neighbourhood, or street address the page attributes that space to.

Restaurant groups often publish ONE page covering every location they operate. If the page covers several locations, set location_match to the location that space belongs to. If the page describes a single restaurant and names no location per space, set location_match to null.

Record only what the page states. Never infer or estimate a capacity: if no number is given, use null.

Also record the restaurant's primary cuisine exactly as the page states it; use null if the page does not say.`;

/** Run the structured extraction over already-fetched page text. */
async function extractFromText(text: string): Promise<z.infer<typeof ExtractionSchema> | null> {
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(ExtractionSchema) },
    messages: [{ role: "user", content: `${EXTRACTION_PROMPT}\n\n---\n\n${text}` }],
  });
  return response.parsed_output ?? null;
}

/**
 * Fetch and extract from a single candidate URL. Returns null — rather than
 * throwing — for anything that didn't pan out (unreachable, not HTML, or no
 * rooms found), so callers can fall through to the next, more expensive
 * stage without special-casing failure modes.
 */
async function tryFreeExtract(
  url: string | null
): Promise<{ url: string; parsed: z.infer<typeof ExtractionSchema> } | null> {
  if (!url) return null;
  const text = await fetchText(url);
  if (!text) return null;
  const parsed = await extractFromText(text);
  if (!parsed || parsed.rooms.length === 0) return null;
  return { url, parsed };
}

/** True when `url`'s host is exactly `domain` or a subdomain of it. */
function hostMatches(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const bare = domain.replace(/^www\./, "");
    return host === bare || host.endsWith(`.${bare}`);
  } catch {
    return false;
  }
}

/**
 * Classifies a search-derived source URL for confidenceForSource. A hit on
 * the venue's own hostname is as trustworthy as the free stages; a hit on a
 * known directory (OpenTable, PartySlate, EventUp, Tripleseat) is the next
 * tier down; anything else — including no determinable URL at all — is the
 * weakest tier and never earns "likely" on its own.
 */
function classifySource(sourceUrl: string | null, homepage: string): CapacitySource {
  if (!sourceUrl) return "search";
  if (hostMatches(sourceUrl, new URL(homepage).hostname)) return "own-site";
  if (ENRICHMENT_DOMAINS.some((d) => hostMatches(sourceUrl, d))) return "directory";
  return "search";
}

/**
 * Restaurant groups publish one page per group, not per branch, and a
 * directory search result's own URL slug often names the branch even when
 * the page prose doesn't ("opentable.com/r/havana-central-times-square-new-york").
 * Used only to fill in location_match when the model left it null, so the
 * location guard still has something to check a directory hit against.
 */
function slugLocationHint(url: string): string | null {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const words = segment
      .replace(/[-_]+/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return words.length > 0 ? words : null;
  } catch {
    return null;
  }
}

/** Collect URLs the search tool actually surfaced, restricted to allowed domains. */
function collectCitedUrls(content: Anthropic.ContentBlock[], allowedDomains: string[]): string[] {
  const isAllowed = (url: string) => allowedDomains.some((d) => hostMatches(url, d));
  const urls: string[] = [];
  const add = (url: string) => {
    if (isAllowed(url) && !urls.includes(url)) urls.push(url);
  };
  for (const block of content) {
    if (block.type === "text") {
      for (const citation of block.citations ?? []) {
        if (citation.type === "web_search_result_location") add(citation.url);
      }
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === "web_search_result") add(result.url);
      }
    }
  }
  return urls;
}

/** Best-effort restaurant name for the search query — the overlay's display
 * name when one exists, otherwise a guess from the homepage's hostname. */
function bestEffortName(homepage: string, overlayName: string | undefined): string {
  if (overlayName) return overlayName;
  try {
    const host = new URL(homepage).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/[-_]+/g, " ");
  } catch {
    return homepage;
  }
}

function searchPrompt(
  name: string,
  homepage: string,
  venue: { city: string; address: string; neighbourhood: string | null }
): string {
  const where = [venue.neighbourhood, venue.city].filter(Boolean).join(", ");
  return `Search for private dining or event space capacity information for the specific restaurant "${name}"${
    where ? ` in ${where}` : ""
  }${venue.address ? ` at ${venue.address}` : ""} (official site: ${homepage}).

This restaurant may belong to a group with several branches in different cities or neighbourhoods. You must find the private-dining page for THIS EXACT branch — not a listicle that only names the chain, and not another branch's page. If a result covers several locations, use only the section that names this branch's own city, neighbourhood, or street address. If you cannot confirm which branch a result describes, do not report its rooms.

${EXTRACTION_PROMPT}`;
}

/**
 * Domain-restricted web search, the last and only metered stage — tried only
 * once both the homepage link and the conventional-path probes have come up
 * empty. Restricted to directories that actually carry capacity data plus
 * the venue's own hostname; unrestricted search returns listicles that name
 * a chain without saying which branch, which is exactly the attribution
 * failure the location guard exists to catch.
 *
 * Anthropic's structured outputs (`output_config.format`) may not compose
 * with a citation-emitting server tool like web search — this has not been
 * verified against the live API. The single combined call is tried first;
 * on a 400 the code falls back to two calls: one search call that returns
 * prose (with citations pointing at the real source), then a second
 * `messages.parse()` extraction over that prose.
 */
async function searchAndExtractCapacity(
  homepage: string,
  venue: { city: string; address: string; neighbourhood: string | null },
  overlayName: string | undefined
): Promise<{
  parsed: z.infer<typeof ExtractionSchema>;
  sourceUrl: string | null;
  source: CapacitySource;
} | null> {
  const allowedDomains = [...ENRICHMENT_DOMAINS, new URL(homepage).hostname];
  const searchTool: Anthropic.WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 3,
    allowed_domains: allowedDomains,
  };
  const prompt = searchPrompt(bestEffortName(homepage, overlayName), homepage, venue);

  // Attempt 1: search and structured output in the same call.
  try {
    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      tools: [searchTool],
      output_config: { format: zodOutputFormat(SearchExtractionSchema) },
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = response.parsed_output;
    if (!parsed || parsed.rooms.length === 0) return null;
    const sourceUrl = parsed.source_url ?? collectCitedUrls(response.content, allowedDomains)[0] ?? null;
    return { parsed, sourceUrl, source: classifySource(sourceUrl, homepage) };
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.warn(
      `    structured output + web search rejected (${e.message}); falling back to two-call extraction`
    );
  }

  // Attempt 2 (fallback): a plain search call returning prose, then a
  // separate structured extraction over that prose.
  const searchResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [searchTool],
    messages: [{ role: "user", content: prompt }],
  });
  const citedUrls = collectCitedUrls(searchResponse.content, allowedDomains);
  const prose = searchResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  if (!prose.trim()) return null;

  const extraction = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(SearchExtractionSchema) },
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nSources consulted: ${citedUrls.join(", ") || "none"}\n\n---\n\n${prose}`,
      },
    ],
  });
  const parsed = extraction.parsed_output;
  if (!parsed || parsed.rooms.length === 0) return null;
  const sourceUrl = citedUrls[0] ?? parsed.source_url ?? null;
  return { parsed, sourceUrl, source: classifySource(sourceUrl, homepage) };
}

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

    // Stage 1 (free): a private-dining/events link found on the homepage.
    const linkedUrl = await findEventsPage(homepage);
    let hit = await tryFreeExtract(linkedUrl);

    // Stage 2 (free): conventional paths on the same domain — only once the
    // homepage-link search itself came back empty.
    if (!hit && !linkedUrl) {
      hit = await tryFreeExtract(await probeEventPaths(homepage));
    }

    // Still free: the bare homepage text itself, in case the site describes
    // private dining without a dedicated page.
    if (!hit) {
      hit = await tryFreeExtract(homepage);
    }

    let sourceUrl: string | null;
    let parsed: z.infer<typeof ExtractionSchema>;
    let source: CapacitySource;

    if (hit) {
      sourceUrl = hit.url;
      parsed = hit.parsed;
      source = "own-site";
    } else {
      // Stage 3 (metered): domain-restricted search, only when every free
      // stage above came up empty.
      const searched = await searchAndExtractCapacity(
        homepage,
        venue,
        overlay.get(String(id))?.name
      );
      if (!searched) {
        console.warn(`  ${id}: no private-dining data found on the site or via search`);
        continue;
      }
      sourceUrl = searched.sourceUrl;
      parsed = searched.parsed;
      source = searched.source;
    }

    // A branch-specific directory URL's slug often names the branch even
    // when the model found no location in the page text itself — give the
    // guard that signal instead of letting a null location_match auto-pass.
    const branchHint = source === "directory" && sourceUrl ? slugLocationHint(sourceUrl) : null;
    const roomsForGuard: ExtractedBlock[] = parsed.rooms.map((r) => ({
      ...r,
      location_match: r.location_match ?? branchHint,
    }));

    const kept = roomsForGuard.filter((r) => acceptRoomBlock(r, venue));
    const dropped = roomsForGuard.length - kept.length;

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
      source_url: sourceUrl,
      confidence: confidenceForSource(source, kept),
      extracted_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    console.log(
      `  ✓ ${id}: ${kept.length} room(s) via ${source} (${sourceUrl ?? "no url"})` +
        (dropped > 0 ? `, ${dropped} dropped as another location` : "")
    );
  } catch (e) {
    console.warn(`  ${id}: ${(e as Error).message}`);
  }
  // One request per host per second is polite; these are small sites.
  await new Promise((r) => setTimeout(r, 1000));
}
