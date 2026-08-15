import raw from "@/data/overlay.json";
import type { OverlayEntry } from "./merge-venue";

export function loadOverlay(): OverlayEntry[] {
  return raw as unknown as OverlayEntry[];
}

/** Only entries with a confirmed TripAdvisor match are addressable. */
export function overlayByLocationId(): Map<string, OverlayEntry> {
  const map = new Map<string, OverlayEntry>();
  for (const entry of loadOverlay()) {
    if (entry.ta_location_id) map.set(entry.ta_location_id, entry);
  }
  return map;
}
