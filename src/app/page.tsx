"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { PlansDrawer } from "@/components/PlansDrawer";
import { ReservationModal } from "@/components/ReservationModal";
import { SearchPanel, type SearchFormValues } from "@/components/SearchPanel";
import { VenueCard } from "@/components/VenueCard";
import { rankVenues, type RankResult } from "@/lib/ranking";
import { FALLBACK_VENUES } from "@/lib/venues";
import type { SearchParams, Venue } from "@/lib/types";

const MapPanel = dynamic(() => import("@/components/MapPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-sage/50 text-[13px] text-ink-soft">
      Loading map…
    </div>
  ),
});

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useState<SearchParams | null>(null);
  const [ranked, setRanked] = useState<RankResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planVenue, setPlanVenue] = useState<Venue | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const [plansRefresh, setPlansRefresh] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const cuisines = useMemo(
    () => [...new Set(venues.map((v) => v.cuisine).filter(Boolean))].sort(),
    [venues]
  );

  const search = async (values: SearchFormValues) => {
    setBusy(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(values.address)}`);
      const geo = (await res.json()) as {
        lat?: number;
        lng?: number;
        label?: string;
        error?: string;
      };
      if (!res.ok || geo.lat === undefined || geo.lng === undefined) {
        throw new Error(geo.error ?? "Could not locate that address.");
      }
      const p: SearchParams = {
        address: values.address,
        lat: geo.lat,
        lng: geo.lng,
        headcount: values.headcount,
        maxCommuteMinutes: values.maxCommuteMinutes,
        commuteMode: values.commuteMode,
        eventStyle: values.eventStyle,
        cuisine: values.cuisine,
        dietary: values.dietary,
      };
      setParams(p);
      const vres = await fetch(
        `/api/venues/search?lat=${p.lat}&lng=${p.lng}` +
          `&minutes=${p.maxCommuteMinutes}&mode=${p.commuteMode}`
      );
      const payload = (await vres.json()) as {
        venues: Venue[];
        notice: string | null;
      };
      const found = payload.venues.length > 0 ? payload.venues : FALLBACK_VENUES;
      setVenues(found);
      setNotice(payload.notice);
      setRanked(rankVenues(found, p));
      setSelectedId(null);
      listRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setNotice(null);
      setSearchError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectVenue = (id: string) => {
    setSelectedId(id);
    document
      .getElementById(`venue-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const MAX_RESULTS = 10;
  const allResults = ranked?.results ?? [];
  const results = allResults.slice(0, MAX_RESULTS);
  const top = results.slice(0, 3);
  const rest = results.slice(3);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-hairline bg-paper px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-brass">
            Nowadays
          </span>
          <h1 className="font-display text-[20px] font-semibold text-ink">
            Private Dining Finder
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlansOpen(true)}
            className="rounded-lg border border-hairline bg-paper px-3.5 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:border-bottle hover:text-bottle"
          >
            Saved plans
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Left rail: search + ranked results */}
        <div
          ref={listRef}
          className="rail-scroll flex w-full flex-col gap-4 overflow-y-auto border-r border-hairline p-4 md:w-[480px] md:shrink-0"
        >
          <section className="rounded-xl border border-hairline bg-paper p-4">
            <h2 className="mb-3 font-display text-[16px] font-semibold text-ink">
              Where is the group?
            </h2>
            <SearchPanel
              cuisines={cuisines}
              busy={busy}
              error={searchError}
              onSearch={search}
            />
          </section>

          {ranked && params && (
            <section aria-live="polite">
              {notice && (
                <p className="mb-2 rounded bg-claret-soft px-2 py-1 text-[12px] text-claret">
                  {notice}
                </p>
              )}
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-display text-[16px] font-semibold text-ink">
                  {allResults.length > MAX_RESULTS
                    ? `Top ${MAX_RESULTS} of ${allResults.length} venues found`
                    : `${allResults.length} venue${allResults.length === 1 ? "" : "s"} found`}
                </h2>
                <span className="font-data text-[11px] text-ink-soft">
                  {params.commuteMode} · ≤{params.maxCommuteMinutes} min
                </span>
              </div>
              <p className="mb-3 text-[12px] text-ink-soft">
                Ranked by {params.cuisine ? "cuisine match, " : ""}capacity fit, commute,
                private rooms, price signal, and trust.
                {ranked.excludedByCommute > 0 &&
                  ` ${ranked.excludedByCommute} excluded by commute limit.`}
                {ranked.excludedByDietary > 0 &&
                  ` ${ranked.excludedByDietary} excluded by dietary needs.`}
              </p>

              {results.length === 0 ? (
                <div className="rounded-xl border border-hairline bg-paper p-5 text-center">
                  <p className="font-display text-[15px] font-semibold text-ink">
                    No venues fit these constraints
                  </p>
                  <p className="mt-1 text-[13px] text-ink-soft">
                    Widen the commute window, switch to driving, or relax the dietary filters.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brass">
                    Top three fits
                  </p>
                  <div className="flex flex-col gap-3">
                    {top.map((r) => (
                      <VenueCard
                        key={r.venue.id}
                        result={r}
                        commuteMode={params.commuteMode}
                        eventStyle={params.eventStyle}
                        headcount={params.headcount}
                        selected={selectedId === r.venue.id}
                        onSelect={() => setSelectedId(r.venue.id)}
                        onPlan={() => setPlanVenue(r.venue)}
                      />
                    ))}
                  </div>
                  {rest.length > 0 && (
                    <>
                      <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                        More options
                      </p>
                      <div className="flex flex-col gap-3">
                        {rest.map((r) => (
                          <VenueCard
                            key={r.venue.id}
                            result={r}
                            commuteMode={params.commuteMode}
                            eventStyle={params.eventStyle}
                            headcount={params.headcount}
                            selected={selectedId === r.venue.id}
                            onSelect={() => setSelectedId(r.venue.id)}
                            onPlan={() => setPlanVenue(r.venue)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          )}

          {!ranked && (
            <section className="rounded-xl border border-dashed border-hairline p-5 text-center">
              <p className="font-display text-[15px] font-semibold text-ink">
                Search to see ranked venues
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">
                Enter the group&apos;s address, headcount, and commute limit — or try one of the
                scenario shortcuts. Results rank by best overall fit, and every listing shows
                how it earned its place.
              </p>
            </section>
          )}
        </div>

        {/* Right: map */}
        <div className="hidden min-w-0 flex-1 md:block">
          <MapPanel
            origin={
              params ? { lat: params.lat, lng: params.lng, label: params.address } : null
            }
            results={results}
            selectedId={selectedId}
            onSelect={selectVenue}
            commuteMode={params?.commuteMode ?? "walking"}
          />
        </div>
      </main>

      {planVenue && params && (
        <ReservationModal
          venue={planVenue}
          params={params}
          onClose={() => setPlanVenue(null)}
          onSaved={() => setPlansRefresh((k) => k + 1)}
        />
      )}
      {plansOpen && (
        <PlansDrawer key={plansRefresh} onClose={() => setPlansOpen(false)} />
      )}
    </div>
  );
}
