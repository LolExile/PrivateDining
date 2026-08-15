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
  // Kept as strings so the fields can be cleared and retyped freely; parsed on submit.
  const [headcount, setHeadcount] = useState("30");
  const [maxCommute, setMaxCommute] = useState("20");
  const [mode, setMode] = useState<CommuteMode>("walking");
  const [style, setStyle] = useState<EventStyle>("seated");
  const [cuisine, setCuisine] = useState<string>("");
  const [dietary, setDietary] = useState<string[]>([]);
  const [showOptional, setShowOptional] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isInvalidCount = (raw: string) =>
    raw.trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 1;

  const headcountInvalid = isInvalidCount(headcount);
  const maxCommuteInvalid = isInvalidCount(maxCommute);

  const submit = (values?: SearchFormValues) => {
    if (values) {
      setAddress(values.address);
      setHeadcount(String(values.headcount));
      setMaxCommute(String(values.maxCommuteMinutes));
      setMode(values.commuteMode);
      setStyle(values.eventStyle);
      setCuisine(values.cuisine ?? "");
      setDietary(values.dietary);
      setFormError(null);
      onSearch(values);
      return;
    }

    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setFormError("Enter an address or landmark to search.");
      return;
    }

    if (headcountInvalid) {
      setFormError("Headcount must be at least 1 — enter how many people are attending.");
      return;
    }

    if (maxCommuteInvalid) {
      setFormError("Max commute must be at least 1 minute.");
      return;
    }

    setFormError(null);
    onSearch({
      address: trimmedAddress,
      headcount: Math.floor(Number(headcount)),
      maxCommuteMinutes: Math.floor(Number(maxCommute)),
      commuteMode: mode,
      eventStyle: style,
      cuisine: cuisine || null,
      dietary,
    });
  };

  const toggleDietary = (key: string) =>
    setDietary((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
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
          onChange={(e) => {
            setAddress(e.target.value);
            setFormError(null);
          }}
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
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            className={`${inputCls} font-data`}
            value={headcount}
            onChange={(e) => {
              setHeadcount(e.target.value);
              setFormError(null);
            }}
            aria-invalid={formError !== null && headcountInvalid}
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
            inputMode="numeric"
            min={1}
            max={120}
            step={1}
            className={`${inputCls} font-data`}
            value={maxCommute}
            onChange={(e) => {
              setMaxCommute(e.target.value);
              setFormError(null);
            }}
            aria-invalid={formError !== null && maxCommuteInvalid}
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

      {(formError ?? error) && (
        <p
          role="alert"
          className="rounded-lg bg-claret-soft px-3 py-2 text-[13px] text-claret"
        >
          {formError ?? error}
        </p>
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
