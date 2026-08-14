import type { TrustLabel, Venue } from "@/lib/types";
import { PRICE_TIER_LABELS } from "@/lib/types";

const TRUST_STYLES: Record<TrustLabel, { text: string; cls: string; dot: string }> = {
  verified: {
    text: "Verified",
    cls: "bg-sage text-bottle-deep",
    dot: "bg-bottle",
  },
  likely: {
    text: "Likely",
    cls: "bg-brass-soft text-ink",
    dot: "bg-brass",
  },
  unverified: {
    text: "Needs a call",
    cls: "bg-claret-soft text-claret",
    dot: "bg-claret",
  },
};

export function TrustBadge({ label, prefix }: { label: TrustLabel; prefix?: string }) {
  const s = TRUST_STYLES[label];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${s.cls}`}
      title={`${prefix ? prefix + " " : ""}${label === "unverified" ? "unverified — confirm by phone" : label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {prefix ? `${prefix}: ` : ""}
      {s.text}
    </span>
  );
}

export function PriceSignal({ venue }: { venue: Venue }) {
  const tier = venue.price_tier ? PRICE_TIER_LABELS[venue.price_tier] : null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-data text-[13px] font-semibold text-ink">
        {venue.min_spend
          ? `$${venue.min_spend.toLocaleString()} min`
          : tier ?? "Price unknown"}
      </span>
      <TrustBadge label={venue.price_trust} />
    </span>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="text-[12px] text-ink-soft">No rating</span>;
  }
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <span className="inline-flex items-center gap-1.5" title={`${rating.toFixed(1)} stars (Yelp)`}>
      <span className="relative inline-block text-[13px] leading-none tracking-[1px]">
        <span className="text-hairline">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden whitespace-nowrap text-brass"
          style={{ width: `${pct}%` }}
        >
          ★★★★★
        </span>
      </span>
      <span className="font-data text-[12px] font-medium text-ink">{rating.toFixed(1)}</span>
    </span>
  );
}
