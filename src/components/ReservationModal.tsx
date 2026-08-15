"use client";

import { useEffect, useState } from "react";
import {
  createReservation,
  listAttendees,
  upsertAttendees,
  type NewAttendee,
} from "@/lib/reservations";
import type { Attendee, SearchParams, Venue } from "@/lib/types";

interface ReservationModalProps {
  venue: Venue;
  params: SearchParams;
  onClose: () => void;
  onSaved: () => void;
}

interface DraftAttendee extends NewAttendee {
  key: number;
}

const inputCls =
  "w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-ink-soft/60 focus:border-bottle focus:outline-none focus:ring-2 focus:ring-bottle/15";

export function ReservationModal({ venue, params, onClose, onSaved }: ReservationModalProps) {
  const [title, setTitle] = useState(`Dinner at ${venue.name}`);
  const [eventDate, setEventDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<Attendee[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [selectedSaved, setSelectedSaved] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<DraftAttendee[]>([
    { key: 0, full_name: "", email: "", phone: "", dietary_notes: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    listAttendees()
      .then((a) => setSaved(a))
      .catch((e: Error) => setSavedError(e.message))
      .finally(() => setSavedLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleSaved = (id: string) =>
    setSelectedSaved((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const updateDraft = (key: number, field: keyof NewAttendee, value: string) =>
    setDrafts((d) => d.map((a) => (a.key === key ? { ...a, [field]: value } : a)));

  const addDraft = () =>
    setDrafts((d) => [
      ...d,
      { key: Math.max(0, ...d.map((x) => x.key)) + 1, full_name: "", email: "", phone: "", dietary_notes: "" },
    ]);

  const removeDraft = (key: number) => setDrafts((d) => d.filter((a) => a.key !== key));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const filled = drafts
        .filter((d) => d.full_name.trim().length > 0)
        .map((d) => ({
          full_name: d.full_name.trim(),
          email: d.email?.trim() || null,
          phone: d.phone?.trim() || null,
          dietary_notes: d.dietary_notes?.trim() || null,
        }));
      const createdAttendees = await upsertAttendees(filled);
      const attendeeIds = [
        ...new Set([...selectedSaved, ...createdAttendees.map((a) => a.id)]),
      ];
      await createReservation(
        {
          venue_id: venue.id,
          venue_name: venue.name,
          venue_address: venue.address,
          venue_lat: venue.lat,
          venue_lng: venue.lng,
          // Use the real field. `venue.id` is `ta-<id>` only for live-only
          // venues; a curated one's id is a slug like "carmines-times-square",
          // and string-stripping it would store the slug as a TripAdvisor id.
          venue_ta_id: venue.ta_location_id,
          venue_ta_url: venue.ta_url,
          venue_rating: venue.rating,
          venue_image_url: venue.image_url,
          title: title.trim() || `Dinner at ${venue.name}`,
          event_date: eventDate || null,
          headcount: params.headcount,
          search_address: params.address,
          commute_mode: params.commuteMode,
          notes: notes.trim() || null,
        },
        attendeeIds
      );
      setDone(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Plan dinner at ${venue.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-linen shadow-2xl">
        <div className="flex items-start justify-between border-b border-hairline bg-paper px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
              New dinner plan
            </p>
            <h2 className="font-display text-[20px] font-semibold text-ink">{venue.name}</h2>
            <p className="text-[12px] text-ink-soft">
              {venue.address} · party of {params.headcount}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-soft hover:bg-sage hover:text-ink"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sage text-bottle">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                <path d="M4 12l5 5L18 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <p className="font-display text-[18px] font-semibold text-ink">Plan saved</p>
            <p className="max-w-xs text-[13px] text-ink-soft">
              The dinner and its attendees are stored. Find it any time under Saved plans, and
              reuse these attendee profiles for your next event.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg bg-bottle px-5 py-2 text-[13px] font-bold text-white hover:bg-bottle-deep"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="rail-scroll flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    Plan name
                  </label>
                  <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    Event date (optional)
                  </label>
                  <input
                    type="date"
                    className={`${inputCls} font-data`}
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    Notes (optional)
                  </label>
                  <input
                    className={inputCls}
                    placeholder="AV needs, budget, timing…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                Saved attendee profiles
              </h3>
              {savedLoading ? (
                <p className="mb-4 text-[13px] text-ink-soft">Loading profiles…</p>
              ) : savedError ? (
                <p className="mb-4 rounded-lg bg-claret-soft px-3 py-2 text-[12px] text-claret">
                  {savedError}
                </p>
              ) : saved.length === 0 ? (
                <p className="mb-4 text-[13px] text-ink-soft">
                  No saved profiles yet — attendees you add below are saved for your next dinner.
                </p>
              ) : (
                <div className="mb-4 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-hairline bg-paper p-2">
                  {saved.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-sage/60"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSaved.has(a.id)}
                        onChange={() => toggleSaved(a.id)}
                        className="h-4 w-4 accent-[#1E4D3B]"
                      />
                      <span className="font-medium text-ink">{a.full_name}</span>
                      <span className="truncate text-[12px] text-ink-soft">
                        {[a.email, a.phone].filter(Boolean).join(" · ")}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                Add attendees
              </h3>
              <div className="flex flex-col gap-3">
                {drafts.map((d) => (
                  <div key={d.key} className="rounded-lg border border-hairline bg-paper p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        className={inputCls}
                        placeholder="Full name"
                        value={d.full_name}
                        onChange={(e) => updateDraft(d.key, "full_name", e.target.value)}
                      />
                      <input
                        className={inputCls}
                        type="email"
                        placeholder="Email"
                        value={d.email ?? ""}
                        onChange={(e) => updateDraft(d.key, "email", e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder="Phone"
                        value={d.phone ?? ""}
                        onChange={(e) => updateDraft(d.key, "phone", e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder="Dietary notes (e.g. peanut allergy)"
                        value={d.dietary_notes ?? ""}
                        onChange={(e) => updateDraft(d.key, "dietary_notes", e.target.value)}
                      />
                    </div>
                    {drafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDraft(d.key)}
                        className="mt-2 text-[12px] font-semibold text-claret hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDraft}
                  className="self-start text-[13px] font-semibold text-bottle underline-offset-2 hover:underline"
                >
                  + Add another attendee
                </button>
              </div>

              {error && (
                <p className="mt-3 rounded-lg bg-claret-soft px-3 py-2 text-[13px] text-claret">
                  {error}
                </p>
              )}
            </div>

            <div className="border-t border-hairline bg-paper px-5 py-3">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="w-full rounded-lg bg-bottle px-4 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-bottle-deep disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save dinner plan"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
