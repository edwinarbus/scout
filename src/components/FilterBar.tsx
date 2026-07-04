"use client";

import type { AgeBucket, SizeNormalized } from "@/lib/types";
import type { StatusGroup } from "./ui";

/**
 * The browse view's filter bar — deliberately minimal: a search box, size,
 * age, and the live count. Browse already shows only adoptable dogs with real
 * photos, so status/source/freshness knobs earned their keep out of the UI
 * (the Filters shape keeps those fields so the filtering logic — and any
 * future power-user surface — doesn't churn).
 */

export interface Filters {
  q: string;
  statuses: StatusGroup[];
  sizes: SizeNormalized[];
  ageBuckets: AgeBucket[];
  sourceId: string;
  showStale: boolean;
  showHidden: boolean;
  onlyMatches: boolean;
  onlyMine: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  statuses: [],
  sizes: [],
  ageBuckets: [],
  sourceId: "all",
  showStale: false,
  showHidden: false,
  onlyMatches: false,
  onlyMine: false,
};

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition ${
        active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900"
      }`}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(arr: T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export default function FilterBar({
  filters,
  onChange,
  count,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  count: number;
}) {
  const f = filters;
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-cream-200 bg-white/80 px-4 py-2.5 backdrop-blur-sm">
      <input
        value={f.q}
        onChange={(e) => set({ q: e.target.value })}
        placeholder="Search name, breed, bio…"
        // text-base (16px), not the smaller 13px this box reads at everywhere
        // else: iOS Safari auto-zooms the page on focus for any input
        // rendering text under 16px.
        className="mr-2 w-56 rounded-full bg-cream-100 px-3.5 py-1.5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-terra-500/40"
      />

      {(["small", "medium", "large", "xlarge"] as const).map((s) => (
        <Chip key={s} active={f.sizes.includes(s)} onClick={() => set({ sizes: toggle(f.sizes, s) })}>
          {s === "xlarge" ? "XL" : s[0].toUpperCase() + s.slice(1)}
        </Chip>
      ))}

      <span aria-hidden className="mx-1.5 h-4 w-px bg-cream-200" />

      {(["puppy", "young", "adult", "senior"] as const).map((a) => (
        <Chip
          key={a}
          active={f.ageBuckets.includes(a)}
          onClick={() => set({ ageBuckets: toggle(f.ageBuckets, a) })}
        >
          {a[0].toUpperCase() + a.slice(1)}
        </Chip>
      ))}

      <span className="ml-auto pl-2 text-[12.5px] text-ink-400">
        <span className="font-semibold text-ink-700">{count.toLocaleString()}</span> adoptable dogs
      </span>
    </div>
  );
}
