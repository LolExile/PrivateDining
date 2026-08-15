import bundled from "@/data/venues.json";
import { getSupabase } from "./supabase";
import type { Contact, MenuItem, Room, Venue } from "./types";

export const BUNDLED_VENUES = bundled as unknown as Venue[];

interface VenueRow {
  id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
  cuisine: string;
  description: string | null;
  rating: number | null;
  review_count: number | null;
  price_tier: number | null;
  trust_label: Venue["trust_label"];
  dietary: string[] | null;
  event_styles: string[] | null;
  image_url: string | null;
  menu_url: string | null;
  menu_image_url: string | null;
  menu_highlights: MenuItem[] | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  private_rooms: {
    name: string;
    seated_capacity: number | null;
    standing_capacity: number | null;
    notes: string | null;
  }[];
}

export interface VenueSource {
  venues: Venue[];
  source: "supabase" | "bundled";
}

/**
 * Loads venues from Supabase; falls back to the bundled seed (same data)
 * when the database is unreachable or the migration has not been run yet.
 */
export async function loadVenues(): Promise<VenueSource> {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("venues")
        .select("*, private_rooms(name, seated_capacity, standing_capacity, notes)");
      if (!error && data && data.length > 0) {
        return { venues: (data as VenueRow[]).map(rowToVenue), source: "supabase" };
      }
    } catch {
      // fall through to bundled data
    }
  }
  return { venues: BUNDLED_VENUES, source: "bundled" };
}

function rowToVenue(row: VenueRow): Venue {
  const contact: Contact = {
    name: row.contact_name,
    email: row.contact_email,
    phone: row.contact_phone,
  };
  const rooms: Room[] = (row.private_rooms ?? []).map((r) => ({
    name: r.name,
    seated: r.seated_capacity,
    standing: r.standing_capacity,
    notes: r.notes,
  }));
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    region: row.region,
    lat: row.lat,
    lng: row.lng,
    cuisine: row.cuisine,
    description: row.description,
    rating: row.rating === null ? null : Number(row.rating),
    review_count: row.review_count,
    price_tier: row.price_tier,
    trust_label: row.trust_label,
    dietary: row.dietary ?? [],
    event_styles: (row.event_styles ?? ["seated"]) as Venue["event_styles"],
    image_url: row.image_url,
    menu_url: row.menu_url,
    menu_image_url: row.menu_image_url,
    menu_highlights: row.menu_highlights ?? [],
    contact,
    rooms,
    ta_location_id: null,
    ta_url: null,
    ta_rating_image_url: null,
    capacity_source_url: null,
  };
}
