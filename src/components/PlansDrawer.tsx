"use client";

import { useEffect, useState } from "react";
import {
  deleteReservation,
  listReservations,
  type ReservationWithDetails,
} from "@/lib/reservations";

interface PlansDrawerProps {
  onClose: () => void;
}

/** Mounted only while open (and re-keyed on refresh), so state starts fresh. */
export function PlansDrawer({ onClose }: PlansDrawerProps) {
  const [plans, setPlans] = useState<ReservationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReservations()
      .then(setPlans)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const remove = async (id: string) => {
    try {
      await deleteReservation(id);
      setPlans((p) => p.filter((r) => r.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[900] bg-ink/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-linen shadow-2xl"
        aria-label="Saved dinner plans"
      >
        <div className="flex items-center justify-between border-b border-hairline bg-paper px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
              Planner history
            </p>
            <h2 className="font-display text-[20px] font-semibold text-ink">Saved plans</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-soft hover:bg-sage hover:text-ink"
            aria-label="Close saved plans"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="rail-scroll flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-[13px] text-ink-soft">Loading plans…</p>
          ) : error ? (
            <p className="rounded-lg bg-claret-soft px-3 py-2 text-[13px] text-claret">{error}</p>
          ) : plans.length === 0 ? (
            <p className="text-[13px] text-ink-soft">
              No saved plans yet. Pick a venue from the results and add attendees — the dinner and
              its guest profiles land here.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {plans.map((plan) => (
                <li key={plan.id} className="rounded-xl border border-hairline bg-paper p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-[16px] font-semibold text-ink">
                        {plan.title}
                      </h3>
                      <p className="text-[12px] text-ink-soft">
                        {plan.venue_name} · {plan.venue_address}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(plan.id)}
                      className="shrink-0 text-[11px] font-semibold text-claret hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="mt-1.5 font-data text-[12px] text-ink-soft">
                    {plan.headcount} people
                    {plan.event_date ? ` · ${plan.event_date}` : ""}
                    {plan.commute_mode ? ` · from ${plan.search_address} (${plan.commute_mode})` : ""}
                  </p>
                  {plan.notes && <p className="mt-1 text-[12px] italic text-ink-soft">{plan.notes}</p>}
                  {plan.attendees.length > 0 && (
                    <div className="mt-2.5 border-t border-dotted border-hairline pt-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                        Attendees ({plan.attendees.length})
                      </p>
                      <ul className="flex flex-col gap-1">
                        {plan.attendees.map((a) => (
                          <li key={a.id} className="text-[12px] text-ink">
                            <span className="font-medium">{a.full_name}</span>
                            {(a.email || a.phone) && (
                              <span className="text-ink-soft">
                                {" "}
                                — {[a.email, a.phone].filter(Boolean).join(" · ")}
                              </span>
                            )}
                            {a.dietary_notes && (
                              <span className="text-claret"> · {a.dietary_notes}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
