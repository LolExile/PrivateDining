import { getSupabase } from "./supabase";
import type { CapacityEntry } from "./merge-venue";
import type { Room } from "./types";

interface Row {
  ta_location_id: string;
  rooms: Room[] | null;
  source_url: string | null;
  confidence: "likely" | "unverified";
}

/**
 * Extracted private-dining capacity for the given locations. Returns an empty
 * map when Supabase is unreachable: search still works, and venues fall back
 * to "needs a call" rather than the request failing.
 */
export async function loadCapacity(
  locationIds: string[]
): Promise<Map<string, CapacityEntry>> {
  const map = new Map<string, CapacityEntry>();
  if (locationIds.length === 0) return map;
  const supabase = getSupabase();
  if (!supabase) return map;

  try {
    const { data, error } = await supabase
      .from("venue_capacity")
      .select("ta_location_id, rooms, source_url, confidence")
      .in("ta_location_id", locationIds);
    if (error || !data) return map;
    for (const row of data as Row[]) {
      map.set(row.ta_location_id, {
        ta_location_id: row.ta_location_id,
        rooms: row.rooms ?? [],
        source_url: row.source_url,
        confidence: row.confidence,
      });
    }
  } catch {
    // Search must survive a database outage.
  }
  return map;
}
