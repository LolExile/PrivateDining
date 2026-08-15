"use client";

import { useState } from "react";
import { PriceSignal, Stars, TrustBadge } from "./Badges";
import { FitLedger } from "./FitLedger";
import { formatMiles, formatMinutes } from "@/lib/geo";
import type { CommuteMode, EventStyle, RankedVenue } from "@/lib/types";
import { DIETARY_LABELS } from "@/lib/types";

interface VenueCardProps {
  result: RankedVenue;
  commuteMode: CommuteMode;
  eventStyle: EventStyle;
  headcount: number;
  selected: boolean;
  onSelect: () => void;
  onPlan: () => void;
}

const FALLBACK_IMG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'><rect width='400' height='240' fill='#E8EDE7'/><text x='200' y='125' text-anchor='middle' font-family='Georgia' font-size='16' fill='#55605B'>Photo unavailable</text></svg>`
  );

export function VenueCard({
  result,
  commuteMode,
  eventStyle,
  headcount,
  selected,
  onSelect,
  onPlan,
}: VenueCardProps) {
  const { venue, rank, commuteMinutes, distanceMiles, bestRoom, capacityOk, totalScore } = result;
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const top3 = rank <= 3;

  return (
    <article
      id={`venue-${venue.id}`}
      className={`overflow-hidden rounded-xl border bg-paper transition-shadow ${
        selected
          ? "border-bottle shadow-[0_4px_18px_rgb(30_77_59_/_0.18)]"
          : "border-hairline shadow-sm hover:shadow-md"
      }`}
    >
      <button
        type="button"
        onClick={() => {
          onSelect();
          setExpanded((e) => !e);
        }}
        className="block w-full text-left"
        aria-expanded={expanded}
      >
        <div className="flex gap-3 p-3">
          <div className="relative h-24 w-28 shrink-0 overflow-hidden rounded-lg bg-sage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={venue.image_url ?? FALLBACK_IMG}
              alt={venue.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.src = FALLBACK_IMG;
              }}
            />
            <span
              className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full font-data text-[12px] font-semibold ${
                top3 ? "bg-brass text-ink" : "bg-bottle text-white"
              }`}
            >
              {rank}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-[17px] font-semibold leading-tight text-ink">
                {venue.name}
              </h3>
              <span
                className="shrink-0 font-data text-[11px] font-semibold text-ink-soft"
                title="Overall fit score"
              >
                {Math.round(totalScore)}
                <span className="text-hairline">/100</span>
              </span>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-ink-soft">{venue.address}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-data text-[12px] font-medium text-ink">
                {formatMiles(distanceMiles)} · {formatMinutes(commuteMinutes)} {commuteMode}
              </span>
              <Stars rating={venue.rating} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded bg-sage px-1.5 py-0.5 text-[11px] font-semibold text-bottle-deep">
                {venue.cuisine}
              </span>
              <TrustBadge label={venue.trust_label} />
              <PriceSignal venue={venue} />
            </div>
          </div>
        </div>
        <div className="px-3 pb-3">
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <span
              className={`font-semibold ${capacityOk ? "text-bottle" : "text-claret"}`}
            >
              {capacityOk
                ? `Fits ${headcount} ${eventStyle === "reception" ? "standing" : "seated"} — ${bestRoom?.name}`
                : bestRoom && bestRoom.seated === null && bestRoom.standing === null
                  ? `${bestRoom.name} — capacity unconfirmed`
                  : `Largest space fits ${
                      bestRoom
                        ? eventStyle === "reception"
                          ? Math.max(bestRoom.standing ?? 0, bestRoom.seated ?? 0)
                          : (bestRoom.seated ?? 0)
                        : 0
                    } of ${headcount}`}
            </span>
          </div>
          <FitLedger factors={result.factors} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-hairline bg-linen/60 px-3 py-3">
          {venue.description && (
            <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">{venue.description}</p>
          )}

          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            Private rooms & spaces
          </h4>
          <ul className="mb-3 flex flex-col gap-1">
            {venue.rooms.map((room) => (
              <li
                key={room.name}
                className="flex items-baseline justify-between gap-2 text-[13px]"
              >
                <span className="font-medium text-ink">{room.name}</span>
                <span className="flex-1 border-b border-dotted border-hairline" />
                <span className="font-data text-[12px] text-ink-soft">
                  {room.seated === null && room.standing === null
                    ? "capacity unconfirmed"
                    : ""}
                  {room.seated !== null && room.seated > 0 ? `${room.seated} seated` : ""}
                  {room.seated !== null &&
                  room.seated > 0 &&
                  room.standing !== null &&
                  room.standing > 0
                    ? " · "
                    : ""}
                  {room.standing !== null && room.standing > 0
                    ? `${room.standing} standing`
                    : ""}
                </span>
              </li>
            ))}
          </ul>

          {venue.dietary.length > 0 && (
            <>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                Dietary accommodations
              </h4>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {venue.dietary.map((d) => (
                  <span
                    key={d}
                    className="rounded-full bg-sage px-2 py-0.5 text-[11px] font-medium text-bottle-deep"
                  >
                    {DIETARY_LABELS[d] ?? d}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="mb-3">
            <div className="flex items-center gap-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                Menu
              </h4>
              {venue.menu_url && (
                <a
                  href={venue.menu_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold text-bottle underline-offset-2 hover:underline"
                >
                  Open full menu ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => setMenuOpen((m) => !m)}
                className="text-[12px] font-semibold text-bottle underline-offset-2 hover:underline"
              >
                {menuOpen ? "Hide preview" : "Preview"}
              </button>
            </div>
            {menuOpen && (
              <div className="mt-2 rounded-lg border border-hairline bg-paper p-3">
                {venue.menu_image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={venue.menu_image_url}
                    alt={`${venue.name} menu`}
                    className="mb-2 max-h-44 w-full rounded object-cover"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <p className="mb-1 text-center font-display text-[13px] italic text-ink-soft">
                  — sample dishes —
                </p>
                <ul className="flex flex-col gap-1">
                  {venue.menu_highlights.map((m) => (
                    <li key={m.dish} className="flex items-baseline gap-2 text-[13px]">
                      <span className="text-ink">{m.dish}</span>
                      <span className="flex-1 border-b border-dotted border-hairline" />
                      <span className="font-data text-[12px] text-ink-soft">{m.price}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            Contact
          </h4>
          <div className="mb-3 text-[13px] text-ink">
            {venue.contact.name && <p className="font-medium">{venue.contact.name}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {venue.contact.phone && (
                <a className="text-bottle hover:underline" href={`tel:${venue.contact.phone}`}>
                  {venue.contact.phone}
                </a>
              )}
              {venue.contact.email ? (
                <a className="text-bottle hover:underline" href={`mailto:${venue.contact.email}`}>
                  {venue.contact.email}
                </a>
              ) : (
                <span className="text-ink-soft">No email listed — call to confirm details</span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onPlan}
            className="w-full rounded-lg bg-brass px-4 py-2 text-[13px] font-bold text-ink transition-colors hover:brightness-95"
          >
            Choose this venue → add attendees
          </button>
        </div>
      )}
    </article>
  );
}
