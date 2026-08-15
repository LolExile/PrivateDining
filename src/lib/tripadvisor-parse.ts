/**
 * Terra returns price_level as a label ("Mid Range"), not a run of dollar
 * signs. Only "Mid Range" has been observed on a live response, so this map is
 * deliberately conservative: an unrecognised label returns null rather than a
 * guessed tier, because a wrong price tier is worse than a missing one.
 */
const PRICE_LABELS: Record<string, number> = {
  "cheap eats": 1,
  "mid range": 2,
  "mid-range": 2,
  "fine dining": 4,
};

export function parsePriceLevel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const label = raw.trim().toLowerCase();
  if (label in PRICE_LABELS) return PRICE_LABELS[label];
  // Some records may still carry the legacy dollar-sign form.
  const runs = raw.match(/\$+/g);
  if (!runs) return null;
  return Math.min(4, Math.max(1, Math.max(...runs.map((r) => r.length))));
}
