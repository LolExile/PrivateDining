import type { TerraDetails, TerraNearby } from "./tripadvisor";
import type {
  Contact, EventStyle, MenuItem, Room, TrustLabel, Venue,
} from "./types";

/** Curated private-dining data — only what TripAdvisor cannot supply. */
export interface OverlayEntry {
  ta_location_id: string | null;
  id: string;
  /**
   * Display fallbacks, used only when TripAdvisor is unreachable. The live
   * record always wins in mergeVenue; these exist so the demo scenarios still
   * render something when the API is down or the key's IP allowlist is stale.
   */
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string;
  /** Disambiguates branches of a chain for the extraction guard (Task 10). */
  neighbourhood: string | null;
  region: string;
  /** Terra supplies no cuisine field; this is the only source. */
  cuisine: string | null;
  description: string | null;
  dietary: string[];
  event_styles: EventStyle[];
  menu_image_url: string | null;
  menu_highlights: MenuItem[];
  contact: Contact;
  rooms: Room[];
}

/** Machine-extracted capacity from the restaurant's own website. */
export interface CapacityEntry {
  ta_location_id: string;
  rooms: Room[];
  source_url: string | null;
  confidence: "likely" | "unverified";
}

/**
 * Precedence: live TripAdvisor owns the public signals; the curated overlay
 * owns private-dining fields and outranks extraction entirely; extraction
 * fills in only where no overlay entry exists. A venue with neither is
 * honestly labelled "needs a call".
 */
export function mergeVenue(
  live: TerraNearby & Partial<TerraDetails>,
  overlay: OverlayEntry | undefined,
  capacity: CapacityEntry | undefined
): Venue {
  const useCapacity = !overlay && capacity !== undefined;

  const rooms = overlay?.rooms ?? (useCapacity ? capacity.rooms : []);
  const trust_label: TrustLabel = overlay
    ? "verified"
    : useCapacity
      ? capacity.confidence
      : "unverified";

  return {
    id: overlay?.id ?? `ta-${live.id}`,
    name: live.name,
    address: live.address,
    city: live.city,
    region: overlay?.region ?? live.city.toLowerCase().replace(/\s+/g, "-"),
    lat: live.lat,
    lng: live.lng,
    cuisine: overlay?.cuisine ?? "Restaurant",
    description: overlay?.description ?? null,
    rating: live.rating,
    review_count: live.review_count,
    price_tier: live.price_tier ?? null,
    trust_label,
    dietary: overlay?.dietary ?? [],
    event_styles: overlay?.event_styles ?? ["seated", "reception"],
    image_url: null,
    menu_url: live.website,
    menu_image_url: overlay?.menu_image_url ?? null,
    menu_highlights: overlay?.menu_highlights ?? [],
    contact: {
      name: overlay?.contact.name ?? null,
      email: overlay?.contact.email ?? null,
      phone: overlay?.contact.phone ?? live.phone ?? null,
    },
    rooms,
    ta_location_id: live.id,
    ta_url: live.taUrl,
    ta_rating_image_url: live.ratingImageUrl,
    capacity_source_url: useCapacity ? capacity.source_url : null,
  };
}
