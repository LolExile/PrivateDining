/**
 * TripAdvisor returns price_level as a display string ("$$ - $$$").
 * The app stores a 1-4 integer tier; we take the upper bound so a venue is
 * never ranked cheaper than it might actually be.
 */
export function parsePriceLevel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const runs = raw.match(/\$+/g);
  if (!runs) return null;
  const widest = Math.max(...runs.map((r) => r.length));
  return Math.min(4, Math.max(1, widest));
}
