import { loadOverlay } from "./overlay";
import type { Venue } from "./types";

/**
 * Curated venues rendered without live signals. Serves the three demo
 * scenarios when TripAdvisor is unreachable, out of quota, or the key's IP
 * allowlist does not cover this host.
 */
export const FALLBACK_VENUES: Venue[] = loadOverlay()
  .filter((e) => e.ta_location_id !== null)
  .map((e) => ({
    id: e.id,
    name: e.name,
    address: e.address,
    city: e.city,
    region: e.region,
    lat: e.lat,
    lng: e.lng,
    cuisine: "Restaurant",
    description: e.description,
    rating: null,
    review_count: null,
    price_tier: null,
    trust_label: "verified",
    dietary: e.dietary,
    event_styles: e.event_styles,
    image_url: null,
    menu_url: null,
    menu_image_url: e.menu_image_url,
    menu_highlights: e.menu_highlights,
    contact: e.contact,
    rooms: e.rooms,
    ta_location_id: null,
    ta_url: null,
    ta_rating_image_url: null,
    capacity_source_url: null,
  }));
