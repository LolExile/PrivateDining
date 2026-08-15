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
  if (own && claim.includes(own)) {
    const aliases = CITYWIDE_ALIASES[city] ?? [];
    const cityNamed = Boolean(city) && claim.includes(city);
    const aliasNamed = aliases.some((a) => claim.includes(a));
    // Nothing but punctuation or whitespace left once the neighbourhood is
    // removed — a single-location page naming its own room area. A length
    // threshold is not enough here: "Midtown, ATL" leaves "atl", and city
    // abbreviations are exactly how a multi-location group labels branches.
    const nothingElseNamed = !/[a-z0-9]/.test(claim.replace(own, ""));
    if (cityNamed || aliasNamed || nothingElseNamed) return true;
    // The neighbourhood matches but the claim also carries locality text that
    // is neither our city nor one of its aliases — it may be another city's
    // same-named neighbourhood ("Midtown, Atlanta"). Fall through to the
    // stricter rules, which will reject unless our city turns up.
  }

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
