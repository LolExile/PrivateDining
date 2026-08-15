import { NextResponse } from "next/server";
import { commuteRadiusKm, searchGrid } from "@/lib/search-grid";
import { haversineKm } from "@/lib/geo";
import { mergeVenue } from "@/lib/merge-venue";
import { overlayByLocationId } from "@/lib/overlay";
import {
  locationDetails, nearbySearch, TripAdvisorError, type TaDetails,
} from "@/lib/tripadvisor";
import type { CommuteMode, Venue } from "@/lib/types";

/**
 * Details calls dominate the budget. 45 candidates is sized so that 20 still
 * survive dedup, the radius filter, and the commute limit — the user's
 * requirement is 20 results for any address, not 20 candidates.
 */
const MAX_CANDIDATES = 45;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const minutes = Number(url.searchParams.get("minutes"));
  const mode = (url.searchParams.get("mode") ?? "walking") as CommuteMode;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(minutes) ||
    Math.abs(lat) > 89.9
  ) {
    return NextResponse.json(
      { error: "lat, lng and minutes are required, and lat must be a real latitude" },
      { status: 400 }
    );
  }

  const radiusKm = commuteRadiusKm(minutes, mode);
  const overlay = overlayByLocationId();

  // Curated venues inside the radius are always included: with only 10 results
  // per search point, TripAdvisor will otherwise drop the venues that carry
  // the capacity data the ranker depends on.
  const overlayIds = [...overlay.entries()]
    .filter(([, e]) => haversineKm(lat, lng, e.lat, e.lng) <= radiusKm)
    .map(([id]) => id);

  try {
    const grid = searchGrid(lat, lng, radiusKm);
    const hits = (await Promise.all(
      grid.map((p) => nearbySearch(p.lat, p.lng, radiusKm).catch(() => []))
    )).flat();

    const byId = new Map<string, number>();
    for (const hit of hits) {
      const d = hit.distanceKm ?? Number.POSITIVE_INFINITY;
      if (!byId.has(hit.location_id) || d < byId.get(hit.location_id)!) {
        byId.set(hit.location_id, d);
      }
    }
    for (const id of overlayIds) if (!byId.has(id)) byId.set(id, 0);

    const candidates = [...byId.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, MAX_CANDIDATES)
      .map(([id]) => id);

    const details = (await Promise.all(
      candidates.map((id) => locationDetails(id).catch(() => null))
    )).filter((d): d is TaDetails => d !== null);

    const venues: Venue[] = details
      .filter((d) => haversineKm(lat, lng, d.lat, d.lng) <= radiusKm)
      .map((d) => mergeVenue(d, overlay.get(d.location_id), undefined));

    return NextResponse.json({ venues, source: "live", notice: null });
  } catch (error) {
    const notice =
      error instanceof TripAdvisorError
        ? error.status === 403
          ? "TripAdvisor key not authorized — check the IP allowlist."
          : error.status === 429
            ? "TripAdvisor rate limit reached — showing curated venues only."
            : "Live data unavailable — showing curated venues only."
        : "Live data unavailable — showing curated venues only.";
    return NextResponse.json({ venues: [], source: "overlay", notice });
  }
}
