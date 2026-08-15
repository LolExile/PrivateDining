import { NextResponse } from "next/server";
import { commuteRadiusKm, haversineKm } from "@/lib/geo";
import { loadCapacity } from "@/lib/capacity-cache";
import { mergeVenue } from "@/lib/merge-venue";
import { overlayByLocationId } from "@/lib/overlay";
import {
  isDiningExperience,
  locationDetails,
  locationPhoto,
  nearbyRestaurants,
  TripAdvisorError,
  type TerraDetails,
  type TerraNearby,
} from "@/lib/tripadvisor";
import type { CommuteMode, Venue } from "@/lib/types";

/** The owner's requirement: ten restaurants, not twenty. */
const MAX_RESULTS = 10;
/**
 * The dining-experience filter needs a details call to see price_level, so
 * the route can no longer fetch details for exactly the venues it will show.
 * Oversample the nearby pool so there is room for candidates the price
 * filter rejects.
 */
const CANDIDATE_POOL = Math.round(MAX_RESULTS * 2.5);
/** Stop paying for details calls even if a thin neighbourhood never fills 10. */
const MAX_DETAILS_ATTEMPTS = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const num = (key: string): number => {
    const raw = url.searchParams.get(key);
    return raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  };
  const lat = num("lat");
  const lng = num("lng");
  const minutes = num("minutes");
  const mode = (url.searchParams.get("mode") ?? "walking") as CommuteMode;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(minutes) ||
    Math.abs(lat) > 89.9 ||
    minutes <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "lat, lng and minutes are required; lat must be a real latitude and minutes positive",
      },
      { status: 400 }
    );
  }

  const radiusKm = commuteRadiusKm(minutes, mode);
  const overlay = overlayByLocationId();

  try {
    const found = await nearbyRestaurants(lat, lng, radiusKm, CANDIDATE_POOL);
    const inRadius = found.filter(
      (r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm
    );

    // Nearest-first, fetch details and keep only venues that pass the
    // dining-experience price filter (excludes "Cheap Eats"), stopping the
    // moment MAX_RESULTS are kept. Capped at MAX_DETAILS_ATTEMPTS so a thin
    // neighbourhood cannot run away with the details budget.
    const kept: (TerraNearby & Partial<TerraDetails>)[] = [];
    let detailsAttempts = 0;
    for (const r of inRadius) {
      if (kept.length >= MAX_RESULTS || detailsAttempts >= MAX_DETAILS_ATTEMPTS) {
        break;
      }
      detailsAttempts++;
      const details = await locationDetails(r.id).catch(() => null);
      if (!isDiningExperience(details?.price_tier ?? null)) continue;
      kept.push({
        ...r,
        ...(details ?? {}),
        // Details' rating/website fields are nullable. The nearby values
        // already passed isPlausibleVenue (rating) or came from a real
        // source (website), so a null from details must not erase them.
        rating: details?.rating ?? r.rating,
        review_count: details?.review_count ?? r.review_count,
        ratingImageUrl: details?.ratingImageUrl ?? r.ratingImageUrl,
        website: details?.website ?? r.website,
      });
    }

    // Photos only for the final kept list — rejected candidates never cost a
    // photo call.
    const enriched = await Promise.all(
      kept.map(async (r) => {
        const photo = await locationPhoto(r.id).catch(() => null);
        return { ...r, image_url: photo };
      })
    );

    const capacity = await loadCapacity(enriched.map((r) => r.id));
    const venues: Venue[] = enriched.map((r) => {
      const v = mergeVenue(r, overlay.get(r.id), capacity.get(r.id));
      return { ...v, image_url: r.image_url };
    });

    return NextResponse.json({ venues, source: "live", notice: null });
  } catch (error) {
    const notice =
      error instanceof TripAdvisorError
        ? error.status === 401 || error.status === 403
          ? "Tripadvisor rejected the API key — check TRIPADVISOR_API_KEY."
          : error.status === 429
            ? "Tripadvisor rate limit reached — showing curated venues only."
            : "Live data unavailable — showing curated venues only."
        : "Live data unavailable — showing curated venues only.";
    return NextResponse.json({ venues: [], source: "overlay", notice });
  }
}
