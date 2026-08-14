import {
  commuteMinutes,
  haversineKm,
  kmToMiles,
  SEARCH_RADIUS_MILES,
} from "./geo";
import type {
  FactorScore,
  RankedVenue,
  Room,
  SearchParams,
  TrustLabel,
  Venue,
} from "./types";
import { DIETARY_LABELS } from "./types";

/**
 * Ranking weights, in the planner's stated order of importance:
 * cuisine (when chosen) > capacity > commute > private rooms > price > trust.
 * Cuisine additionally hard-sorts matches above non-matches.
 */
const WEIGHTS = {
  cuisine: 35,
  capacity: 25,
  commute: 20,
  rooms: 10,
  price: 6,
  trust: 4,
};

const TRUST_SCORE: Record<TrustLabel, number> = {
  verified: 1,
  likely: 0.6,
  unverified: 0.25,
};

function relevantCapacity(room: Room, style: "seated" | "reception"): number {
  return style === "reception"
    ? Math.max(room.standing, room.seated)
    : room.seated;
}

/** The smallest room that still fits the group, else the largest room. */
function pickBestRoom(
  venue: Venue,
  headcount: number,
  style: "seated" | "reception"
): Room | null {
  if (venue.rooms.length === 0) return null;
  const fitting = venue.rooms
    .filter((r) => relevantCapacity(r, style) >= headcount)
    .sort((a, b) => relevantCapacity(a, style) - relevantCapacity(b, style));
  if (fitting.length > 0) return fitting[0];
  return venue.rooms.reduce((max, r) =>
    relevantCapacity(r, style) > relevantCapacity(max, style) ? r : max
  );
}

export interface RankResult {
  results: RankedVenue[];
  excludedByCommute: number;
  excludedByDietary: number;
}

export function rankVenues(venues: Venue[], params: SearchParams): RankResult {
  let excludedByCommute = 0;
  let excludedByDietary = 0;

  const scored: Omit<RankedVenue, "rank">[] = [];

  for (const venue of venues) {
    const distanceKm = haversineKm(params.lat, params.lng, venue.lat, venue.lng);
    const distanceMiles = kmToMiles(distanceKm);
    if (distanceMiles > SEARCH_RADIUS_MILES) continue;

    const commute = commuteMinutes(distanceKm, params.commuteMode);
    if (commute > params.maxCommuteMinutes) {
      excludedByCommute++;
      continue;
    }

    const dietaryMissing = params.dietary.filter(
      (d) => !venue.dietary.includes(d)
    );
    if (dietaryMissing.length > 0) {
      excludedByDietary++;
      continue;
    }

    const factors: FactorScore[] = [];
    const cuisineMatch = params.cuisine
      ? venue.cuisine.toLowerCase() === params.cuisine.toLowerCase()
      : false;

    if (params.cuisine) {
      factors.push({
        key: "cuisine",
        label: "Cuisine",
        score: cuisineMatch ? 1 : 0,
        weight: WEIGHTS.cuisine,
        detail: cuisineMatch
          ? `Matches ${venue.cuisine}`
          : `${venue.cuisine}, not ${params.cuisine}`,
      });
    }

    const bestRoom = pickBestRoom(venue, params.headcount, params.eventStyle);
    const bestCapacity = bestRoom
      ? relevantCapacity(bestRoom, params.eventStyle)
      : 0;
    const capacityOk = bestCapacity >= params.headcount;
    // A snug fit beats a cavernous room; undersized venues fall away fast.
    const capacityScore = capacityOk
      ? 0.6 + 0.4 * (params.headcount / bestCapacity)
      : 0.5 * (bestCapacity / params.headcount);
    factors.push({
      key: "capacity",
      label: "Capacity",
      score: capacityScore,
      weight: WEIGHTS.capacity,
      detail: capacityOk
        ? `${bestRoom?.name ?? "Room"} fits ${params.headcount} (max ${bestCapacity})`
        : `Largest space holds ${bestCapacity} of ${params.headcount}`,
    });

    const commuteScore = 1 - 0.7 * (commute / params.maxCommuteMinutes);
    factors.push({
      key: "commute",
      label: "Commute",
      score: commuteScore,
      weight: WEIGHTS.commute,
      detail: `${Math.round(commute)} min ${params.commuteMode} of ${params.maxCommuteMinutes} max`,
    });

    const trulyPrivate = venue.rooms.filter(
      (r) => !(r.notes ?? "").toLowerCase().includes("semi-private")
    ).length;
    const roomScore =
      venue.rooms.length === 0 ? 0 : trulyPrivate > 0 ? 1 : 0.5;
    factors.push({
      key: "rooms",
      label: "Private rooms",
      score: roomScore,
      weight: WEIGHTS.rooms,
      detail:
        venue.rooms.length === 0
          ? "No private spaces listed"
          : `${venue.rooms.length} space${venue.rooms.length > 1 ? "s" : ""}${trulyPrivate === 0 ? " (semi-private)" : ""}`,
    });

    const priceScore =
      TRUST_SCORE[venue.price_trust] * (venue.min_spend || venue.price_tier ? 1 : 0.5);
    factors.push({
      key: "price",
      label: "Price signal",
      score: priceScore,
      weight: WEIGHTS.price,
      detail: venue.min_spend
        ? `$${venue.min_spend.toLocaleString()} min spend (${venue.price_trust})`
        : `Tier ${"$".repeat(venue.price_tier ?? 0) || "unknown"} (${venue.price_trust})`,
    });

    factors.push({
      key: "trust",
      label: "Trust",
      score: TRUST_SCORE[venue.trust_label],
      weight: WEIGHTS.trust,
      detail: `Listing ${venue.trust_label}`,
    });

    const activeWeight = factors.reduce((s, f) => s + f.weight, 0);
    const totalScore =
      (factors.reduce((s, f) => s + f.score * f.weight, 0) / activeWeight) * 100;

    scored.push({
      venue,
      totalScore,
      cuisineMatch,
      distanceMiles,
      commuteMinutes: commute,
      bestRoom,
      capacityOk,
      dietaryMissing,
      factors,
    });
  }

  // Cuisine matches always outrank non-matches when a cuisine is chosen.
  scored.sort((a, b) => {
    if (params.cuisine && a.cuisineMatch !== b.cuisineMatch) {
      return a.cuisineMatch ? -1 : 1;
    }
    return b.totalScore - a.totalScore;
  });

  return {
    results: scored.map((s, i) => ({ ...s, rank: i + 1 })),
    excludedByCommute,
    excludedByDietary,
  };
}

export function dietaryLabel(key: string): string {
  return DIETARY_LABELS[key] ?? key;
}
