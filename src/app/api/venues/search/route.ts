import { NextResponse } from "next/server";
import { commuteRadiusKm, haversineKm } from "@/lib/geo";
import { loadCapacity } from "@/lib/capacity-cache";
import { mergeVenue } from "@/lib/merge-venue";
import { overlayByLocationId } from "@/lib/overlay";
import {
  locationDetails,
  locationPhoto,
  nearbyRestaurants,
  TripAdvisorError,
} from "@/lib/tripadvisor";
import type { CommuteMode, Venue } from "@/lib/types";

/** The owner's requirement: ten restaurants, not twenty. */
const MAX_RESULTS = 10;

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
    const found = await nearbyRestaurants(lat, lng, radiusKm, MAX_RESULTS);
    const inRadius = found.filter(
      (r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm
    );

    // One details call and one photo call per surviving restaurant. Both are
    // billable per location, so they run only for venues that will be shown.
    const enriched = await Promise.all(
      inRadius.map(async (r) => {
        const [details, photo] = await Promise.all([
          locationDetails(r.id).catch(() => null),
          locationPhoto(r.id).catch(() => null),
        ]);
        return { ...r, ...(details ?? {}), image_url: photo };
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
