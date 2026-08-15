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
 * Cuisine left the ranker when the app moved to Terra, which supplies no
 * cuisine field. Its 35 points were redistributed proportionally so the
 * remaining factors keep their original relative importance.
 */
const WEIGHTS = {
  capacity: 38,
  commute: 31,
  rooms: 15,
  price: 9,
  trust: 7,
};

const TRUST_SCORE: Record<TrustLabel, number> = {
  verified: 1,
  likely: 0.6,
  unverified: 0.25,
};

function relevantCapacity(room: Room, style: "seated" | "reception"): number | null {
  const values =
    style === "reception" ? [room.standing, room.seated] : [room.seated];
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * The smallest room that still fits the group; else the largest room whose
 * capacity we know; else an unknown-capacity room, which ranks as
 * "unconfirmed" rather than "too small".
 */
function pickBestRoom(
  venue: Venue,
  headcount: number,
  style: "seated" | "reception"
): Room | null {
  if (venue.rooms.length === 0) return null;
  const known = venue.rooms
    .map((r) => ({ room: r, cap: relevantCapacity(r, style) }))
    .filter((x): x is { room: Room; cap: number } => x.cap !== null);
  if (known.length === 0) return venue.rooms[0];
  const fitting = known
    .filter((x) => x.cap >= headcount)
    .sort((a, b) => a.cap - b.cap);
  if (fitting.length > 0) return fitting[0].room;
  return known.reduce((max, x) => (x.cap > max.cap ? x : max)).room;
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

    // Unknown dietary data is unconfirmed, not disqualifying — the same rule
    // capacity follows. A venue with a curated list that lacks a requested tag
    // is genuinely excluded; a live venue with no list at all is kept and
    // flagged, because TripAdvisor supplies no dietary data and excluding on
    // its absence would empty the results whenever any box is ticked.
    const dietaryKnown = venue.dietary.length > 0;
    const dietaryMissing = params.dietary.filter(
      (d) => !venue.dietary.includes(d)
    );
    if (dietaryKnown && dietaryMissing.length > 0) {
      excludedByDietary++;
      continue;
    }
    const dietaryUnconfirmed = !dietaryKnown && params.dietary.length > 0;

    const factors: FactorScore[] = [];
    // Cuisine no longer scores or sorts — Terra supplies no cuisine field,
    // so every live venue would match identically — but the card still
    // shows whether a venue matches the chosen cuisine.
    const cuisineMatch = params.cuisine
      ? venue.cuisine.toLowerCase() === params.cuisine.toLowerCase()
      : false;

    const bestRoom = pickBestRoom(venue, params.headcount, params.eventStyle);
    const bestCapacity = bestRoom
      ? relevantCapacity(bestRoom, params.eventStyle)
      : null;
    const capacityKnown = bestCapacity !== null;
    const capacityOk = capacityKnown && bestCapacity >= params.headcount;
    // Unknown capacity scores as unconfirmed, not as zero: the room may well
    // fit, and burying it under a venue that genuinely holds 4 people is wrong.
    const capacityScore = !capacityKnown
      ? 0.5
      : capacityOk
        ? 0.6 + 0.4 * (params.headcount / bestCapacity)
        : 0.5 * (bestCapacity / params.headcount);
    factors.push({
      key: "capacity",
      label: "Capacity",
      score: capacityScore,
      weight: WEIGHTS.capacity,
      detail: !capacityKnown
        ? bestRoom
          ? `${bestRoom.name} — capacity unconfirmed`
          : "No capacity data"
        : capacityOk
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

    // Price is TripAdvisor's own $-tier. Known beats unknown; nothing else to
    // weigh, since every venue's price comes from the same source.
    const priceKnown = venue.price_tier !== null;
    factors.push({
      key: "price",
      label: "Price signal",
      score: priceKnown ? 1 : 0.5,
      weight: WEIGHTS.price,
      detail: priceKnown
        ? `${"$".repeat(venue.price_tier!)} on Tripadvisor`
        : "No price data",
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
      bestCapacity,
      capacityKnown,
      capacityOk,
      dietaryMissing,
      dietaryUnconfirmed,
      factors,
    });
  }

  scored.sort((a, b) => b.totalScore - a.totalScore);

  return {
    results: scored.map((s, i) => ({ ...s, rank: i + 1 })),
    excludedByCommute,
    excludedByDietary,
  };
}

export function dietaryLabel(key: string): string {
  return DIETARY_LABELS[key] ?? key;
}
