"use client";

import { useMemo, useState } from "react";
import type { AdoptionSourceRow, SourceRunRow } from "@/db/schema";
import SourceCard from "./SourceCard";

export interface SourceCoverage {
  dogs: number;
  activeDogs: number;
  photos: number;
  animalIds: number;
  age: number;
  breed: number;
  location: number;
  description: number;
  status: number;
  stableKeys: number;
  detailExtracted: number;
  intake: number;
}

export type DashboardSource = AdoptionSourceRow & {
  lastRun: SourceRunRow | null;
  lastGoodRunAt: string | null;
  coverage: SourceCoverage | null;
};

type FilterKey =
  | "all"
  | "priority"
  | "enabled"
  | "monitoring_ready"
  | "never_backfilled"
  | "backfill_failed"
  | "backfill_partial"
  | "run_failed"
  | "run_partial"
  | "zero_dogs"
  | "pagination_incomplete"
  | "dedupe_warnings"
  | "weak_ids"
  | "low_confidence"
  | "high_confidence"
  | "needs_review"
  | "disabled";

const FILTERS: Array<[FilterKey, string]> = [
  ["all", "All"],
  ["priority", "Priority"],
  ["enabled", "Enabled"],
  ["monitoring_ready", "Monitoring-ready"],
  ["never_backfilled", "Never backfilled"],
  ["backfill_partial", "Backfill partial"],
  ["backfill_failed", "Backfill failed/blocked"],
  ["run_failed", "Last run failed"],
  ["run_partial", "Last run partial"],
  ["zero_dogs", "Zero dogs"],
  ["pagination_incomplete", "Pagination incomplete"],
  ["dedupe_warnings", "Dedupe warnings"],
  ["weak_ids", "Weak IDs"],
  ["high_confidence", "High confidence"],
  ["low_confidence", "Low confidence"],
  ["needs_review", "Needs review"],
  ["disabled", "Disabled"],
];

function matches(s: DashboardSource, f: FilterKey): boolean {
  const run = s.lastRun;
  switch (f) {
    case "all":
      return true;
    case "priority":
      return s.priority === "critical" || s.priority === "high";
    case "enabled":
      return s.enabled;
    case "monitoring_ready":
      return s.initializedForDailyMonitoring;
    case "never_backfilled":
      return s.backfillStatus === "never";
    case "backfill_failed":
      return s.backfillStatus === "failed" || s.backfillStatus === "blocked";
    case "backfill_partial":
      return s.backfillStatus === "partial";
    case "run_failed":
      return run?.status === "failed" || run?.status === "blocked";
    case "run_partial":
      return run?.status === "partial";
    case "zero_dogs":
      return run != null && run.dogsFound === 0;
    case "pagination_incomplete":
      return run != null && run.paginationCompleted === false;
    case "dedupe_warnings":
      return run != null && (run.duplicatesDetected > 0 || run.listingsMissingStableIds > 0);
    case "weak_ids":
      return run != null && run.dogsFound > 0 && run.listingsMissingStableIds / run.dogsFound > 0.2;
    case "high_confidence":
      return (run?.confidenceScore ?? 0) >= 0.85;
    case "low_confidence":
      return run != null && (run.confidenceScore ?? 0) < 0.6;
    case "needs_review":
      return s.permissionStatus.includes("review") || s.nextDebugStep != null;
    case "disabled":
      return !s.enabled;
  }
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

export default function SourcesDashboard({ sources }: { sources: DashboardSource[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showCoverage, setShowCoverage] = useState(true);

  const filtered = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
    return sources
      .filter((s) => matches(s, filter))
      .sort(
        (a, b) =>
          (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0) ||
          (order[a.priority] ?? 9) - (order[b.priority] ?? 9) ||
          a.name.localeCompare(b.name)
      );
  }, [sources, filter]);

  const stats = {
    ready: sources.filter((s) => s.initializedForDailyMonitoring).length,
    enabled: sources.filter((s) => s.enabled).length,
    neverBackfilled: sources.filter((s) => s.enabled && s.backfillStatus === "never").length,
  };
  const withCoverage = sources.filter((s) => s.coverage && s.coverage.dogs > 0);

  return (
    <div>
      <p className="mb-3 text-sm text-ink-500">
        {stats.enabled} enabled · {stats.ready} initialized for daily monitoring ·{" "}
        {stats.neverBackfilled} enabled but awaiting backfill
      </p>

      {/* filters */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 transition ${
              filter === key
                ? "bg-ink-900 text-white ring-ink-900"
                : "bg-white text-ink-700 ring-cream-200 hover:bg-cream-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* data completeness report */}
      <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <button
          onClick={() => setShowCoverage(!showCoverage)}
          className="font-display text-lg font-semibold"
        >
          Data completeness by source {showCoverage ? "▾" : "▸"}
        </button>
        {showCoverage && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-cream-200 text-left text-ink-500">
                  <th className="py-1.5 pr-3 font-medium">source</th>
                  <th className="px-2 font-medium">dogs</th>
                  <th className="px-2 font-medium">active</th>
                  <th className="px-2 font-medium">photos</th>
                  <th className="px-2 font-medium">IDs</th>
                  <th className="px-2 font-medium">age</th>
                  <th className="px-2 font-medium">breed</th>
                  <th className="px-2 font-medium">loc</th>
                  <th className="px-2 font-medium">bio</th>
                  <th className="px-2 font-medium">status</th>
                  <th className="px-2 font-medium">stable keys</th>
                  <th className="px-2 font-medium">details</th>
                  <th className="px-2 font-medium">intake</th>
                  <th className="px-2 font-medium">confidence</th>
                </tr>
              </thead>
              <tbody>
                {withCoverage.map((s) => {
                  const c = s.coverage!;
                  return (
                    <tr key={s.id} className="border-b border-cream-100">
                      <td className="py-1.5 pr-3 font-medium text-ink-900">{s.id}</td>
                      <td className="px-2">{c.dogs}</td>
                      <td className="px-2">{c.activeDogs}</td>
                      <td className="px-2">{pct(c.photos, c.dogs)}</td>
                      <td className="px-2">{pct(c.animalIds, c.dogs)}</td>
                      <td className="px-2">{pct(c.age, c.dogs)}</td>
                      <td className="px-2">{pct(c.breed, c.dogs)}</td>
                      <td className="px-2">{pct(c.location, c.dogs)}</td>
                      <td className="px-2">{pct(c.description, c.dogs)}</td>
                      <td className="px-2">{pct(c.status, c.dogs)}</td>
                      <td className="px-2">{pct(c.stableKeys, c.dogs)}</td>
                      <td className="px-2">{pct(c.detailExtracted, c.dogs)}</td>
                      <td className="px-2">{pct(c.intake, c.dogs)}</td>
                      <td className="px-2">{s.lastRun?.confidenceScore ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* source cards */}
      <div className="grid gap-3 pb-12">
        {filtered.map((s) => (
          <SourceCard
            key={s.id}
            source={s}
            lastRun={s.lastRun}
            lastGoodRunAt={s.lastGoodRunAt}
            dogCount={s.coverage?.dogs ?? 0}
          />
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-300">No sources match this filter.</p>
        )}
      </div>
    </div>
  );
}
