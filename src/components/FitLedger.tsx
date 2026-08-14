import type { FactorScore } from "@/lib/types";

/**
 * The signature element: a tasting-menu-style ledger line showing how a
 * venue earned its rank, one meter per ranking factor.
 */
export function FitLedger({ factors }: { factors: FactorScore[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-dotted border-hairline pt-2.5">
      {factors.map((f) => (
        <div key={f.key} className="flex min-w-[72px] flex-col gap-1" title={f.detail}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {f.label}
          </span>
          <span className="h-[3px] w-full overflow-hidden rounded-full bg-sage">
            <span
              className={`block h-full rounded-full ${f.score >= 0.65 ? "bg-bottle" : f.score >= 0.35 ? "bg-brass" : "bg-claret"}`}
              style={{ width: `${Math.round(Math.max(0.06, Math.min(1, f.score)) * 100)}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
