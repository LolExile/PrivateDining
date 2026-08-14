"use client";

import { useState } from "react";
import type { CommuteMode, EventStyle } from "@/lib/types";
import { DIETARY_OPTIONS } from "@/lib/types";

export interface SearchFormValues {
  address: string;
  headcount: number;
  maxCommuteMinutes: number;
  commuteMode: CommuteMode;
  eventStyle: EventStyle;
  cuisine: string | null;
  dietary: string[];
}

interface SearchPanelProps {
  cuisines: string[];
  busy: boolean;
  error: string | null;
  onSearch: (values: SearchFormValues) => void;
}

const SCENARIOS: { label: string; values: SearchFormValues }[] = [
  {
    label: "50 · Times Square · 20 min",
    values: {
      address: "Times Square, New York, NY",
      headcount: 50,
      maxCommuteMinutes: 20,
      commuteMode: "walking",
      eventStyle: "seated",
      cuisine: null,
      dietary: [],
    },
  },
  {
    label: "30 · Salesforce Tower · 15 min",
    values: {
      address: "415 Mission St, San Francisco, CA 94105",
      headcount: 30,
      maxCommuteMinutes: 15,
      commuteMode: "walking",
      eventStyle: "seated",
      cuisine: null,
      dietary: [],
    },
  },
  {
    label: "200 · reception · Hilton Hawaiian Village · 15 min walk",
    values: {
      address: "Hilton Hawaiian Village, Waikiki, HI",
      headcount: 200,
      maxCommuteMinutes: 15,
      commuteMode: "walking",
      eventStyle: "reception",
      cuisine: null,
      dietary: [],
    },
  },
];

const inputCls =
  "w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-ink-soft/60 focus:border-bottle focus:outline-none focus:ring-2 focus:ring-bottle/15";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft";

export function SearchPanel({ cuisines, busy, error, onSearch }: SearchPanelProps) {
  const [address, setAddress] = useState("");
  const [headcount, setHeadcount] = useState(30);
  const [maxCommute, setMaxCommute] = useState(20);
  const [mode, setMode] = useState<CommuteMode>("walking");
  const [style, setStyle] = useState<EventStyle>("seated");
  const [cuisine, setCuisine] = useState<string>("");
  const [dietary, setDietary] = useState<string[]>([]);
  const [showOptional, setShowOptional] = useState(false);

  const submit = (values?: SearchFormValues) => {
    const v: SearchFormValues = values ?? {
      address: address.trim(),
      headcount,
      maxCommuteMinutes: maxCommute,
      commuteMode: mode,
      eventStyle: style,
      cuisine: cuisine || null,
      dietary,
    };
    if (values) {
      setAddress(values.address);
      setHeadcount(values.headcount);
      setMaxCommute(values.maxCommuteMinutes);
      setMode(values.commuteMode);
      setStyle(values.eventStyle);
      setCuisine(values.cuisine ?? "");
      setDietary(values.dietary);
    }
    onSearch(v);
  };

  const toggleDietary = (key: string) =>
    setDietary((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label htmlFor="address" className={labelCls}>
          Address or landmark
        </label>
        <input
          id="address"
          className={inputCls}
          placeholder="e.g. 415 Mission St, San Francisco"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="headcount" className={labelCls}>
            Headcount
          </label>
          <input
            id="headcount"
            type="number"
            min={1}
            max={1000}
            className={`${inputCls} font-data`}
            value={headcount}
            onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value)))}
            required
          />
        </div>
        <div>
          <label htmlFor="commute" className={labelCls}>
            Max commute (min)
          </label>
          <input
            id="commute"
            type="number"
            min={1}
            max={120}
            className={`${inputCls} font-data`}
            value={maxCommute}
            onChange={(e) => setMaxCommute(Math.max(1, Number(e.target.value)))}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={labelCls}>Commute mode</span>
          <div className="flex rounded-lg border border-hairline bg-paper p-0.5">
            {(["walking", "driving"] as CommuteMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-semibold capitalize transition-colors ${
                  mode === m ? "bg-bottle text-white" : "text-ink-soft hover:text-ink"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={labelCls}>Event style</span>
          <div className="flex rounded-lg border border-hairline bg-paper p-0.5">
            {(
              [
                ["seated", "Seated"],
                ["reception", "Reception"],
              ] as [EventStyle, string][]
            ).map(([s, label]) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors ${
                  style === s ? "bg-bottle text-white" : "text-ink-soft hover:text-ink"
                }`}
                title={s === "reception" ? "Happy hour / standing reception" : "Seated dinner"}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="self-start text-[12px] font-semibold text-bottle underline-offset-2 hover:underline"
        onClick={() => setShowOptional((s) => !s)}
        aria-expanded={showOptional}
      >
        {showOptional ? "Hide" : "Show"} cuisine & dietary options
      </button>

      {showOptional && (
        <div className="flex flex-col gap-4 rounded-lg bg-sage/60 p-3">
          <div>
            <label htmlFor="cuisine" className={labelCls}>
              Cuisine (optional — ranked first when chosen)
            </label>
            <select
              id="cuisine"
              className={inputCls}
              value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
            >
              <option value="">Any cuisine</option>
              {cuisines.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={labelCls}>Dietary needs (must accommodate)</span>
            <div className="flex flex-wrap gap-1.5">
              {DIETARY_OPTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDietary(d.key)}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    dietary.includes(d.key)
                      ? "border-bottle bg-bottle text-white"
                      : "border-hairline bg-paper text-ink-soft hover:border-bottle/40"
                  }`}
                  aria-pressed={dietary.includes(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-claret-soft px-3 py-2 text-[13px] text-claret">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-bottle px-4 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-bottle-deep disabled:opacity-60"
      >
        {busy ? "Searching…" : "Find venues"}
      </button>

      <div className="border-t border-dotted border-hairline pt-3">
        <span className={labelCls}>Try a scenario</span>
        <div className="flex flex-col gap-1.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => submit(s.values)}
              className="rounded-lg border border-hairline bg-paper px-3 py-1.5 text-left text-[12px] font-medium text-ink-soft transition-colors hover:border-brass hover:text-ink"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
