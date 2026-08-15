export type TrustLabel = "verified" | "likely" | "unverified";
export type EventStyle = "seated" | "reception";
export type CommuteMode = "walking" | "driving";

export interface MenuItem {
  dish: string;
  price: string;
}

export interface Room {
  name: string;
  /** null when the source named the room but stated no capacity. */
  seated: number | null;
  standing: number | null;
  notes: string | null;
}

export interface Contact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface Venue {
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
  trust_label: TrustLabel;
  dietary: string[];
  event_styles: EventStyle[];
  image_url: string | null;
  menu_url: string | null;
  menu_image_url: string | null;
  menu_highlights: MenuItem[];
  contact: Contact;
  rooms: Room[];
  /** TripAdvisor location id — the join key for overlay and capacity data. */
  ta_location_id: string | null;
  /** TripAdvisor listing URL — required by their display terms. */
  ta_url: string | null;
  /** TripAdvisor-hosted bubble rating image; must be used over our own stars. */
  ta_rating_image_url: string | null;
  /** Page the room capacities were extracted from, when machine-extracted. */
  capacity_source_url: string | null;
}

export interface SearchParams {
  address: string;
  lat: number;
  lng: number;
  headcount: number;
  maxCommuteMinutes: number;
  commuteMode: CommuteMode;
  eventStyle: EventStyle;
  cuisine: string | null;
  dietary: string[];
}

export interface FactorScore {
  key: string;
  label: string;
  score: number; // 0..1
  weight: number;
  detail: string;
}

export interface RankedVenue {
  venue: Venue;
  rank: number;
  totalScore: number; // 0..100
  cuisineMatch: boolean;
  distanceMiles: number;
  commuteMinutes: number;
  bestRoom: Room | null;
  bestCapacity: number | null;
  capacityKnown: boolean;
  capacityOk: boolean;
  dietaryMissing: string[];
  factors: FactorScore[];
}

export interface Attendee {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  dietary_notes: string | null;
  created_at?: string;
}

export interface Reservation {
  id: string;
  venue_id: string;
  title: string;
  event_date: string | null;
  headcount: number;
  search_address: string | null;
  commute_mode: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  attendees?: Attendee[];
}

export const DIETARY_OPTIONS: { key: string; label: string }[] = [
  { key: "vegetarian", label: "Vegetarian" },
  { key: "vegan", label: "Vegan" },
  { key: "gluten_free", label: "Gluten-free" },
  { key: "nut_allergy", label: "Nut allergy" },
  { key: "kosher", label: "Kosher (on request)" },
];

export const DIETARY_LABELS: Record<string, string> = Object.fromEntries(
  DIETARY_OPTIONS.map((d) => [d.key, d.label])
);

export const PRICE_TIER_LABELS: Record<number, string> = {
  1: "$",
  2: "$$",
  3: "$$$",
  4: "$$$$",
};
