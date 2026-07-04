"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdoptionSourceRow, SourceRunRow } from "@/db/schema";
import { fmtRel } from "./ui";

const RUN_TONES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  success_with_warnings: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  partial: "bg-amber-50 text-amber-700 ring-amber-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  blocked: "bg-rose-100 text-rose-800 ring-rose-300",
  never: "bg-cream-100 text-ink-500 ring-cream-200",
};

export default function SourceCard({
  source,
  lastRun,
  lastGoodRunAt,
  dogCount,
}: {
  source: AdoptionSourceRow;
  lastRun: SourceRunRow | null;
  lastGoodRunAt?: string | null;
  dogCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const warnings = lastRun?.warnings ?? [];
  const backfillTone = RUN_TONES[source.backfillStatus] ?? RUN_TONES.never;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{source.name}</h3>
            <span className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-500">
              {source.sourceSystem}
            </span>
            <span className="rounded bg-cream-100 px-1.5 py-0.5 text-[10px] uppercase text-ink-500">
              {source.priority}
            </span>
            {source.parserVersion && (
              <span className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
                {source.parserVersion}
              </span>
            )}
            {source.region && <span className="text-[12px] text-ink-300">{source.region}</span>}
          </div>
          <a
            href={source.listingUrl.startsWith("http") ? source.listingUrl : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-[12px] text-terra-600 underline decoration-cream-200 underline-offset-2"
          >
            {source.listingUrl}
          </a>
        </div>
        <div className="flex items-center gap-2">
          {source.initializedForDailyMonitoring ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-300">
              ● Daily monitoring active
            </span>
          ) : source.enabled ? (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-300">
              ◌ Awaiting backfill
            </span>
          ) : null}
          <button
            onClick={toggle}
            disabled={busy}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition disabled:opacity-50 ${
              source.enabled
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                : "bg-cream-100 text-ink-500 ring-cream-200 hover:bg-cream-200"
            }`}
          >
            {source.enabled ? "Enabled ✓" : "Disabled"}
          </button>
        </div>
      </div>

      {/* operational badges */}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <Badge label={`robots: ${source.robotsStatus}`} />
        <Badge label={`permission: ${source.permissionStatus}`} />
        {source.robotsOverrideReason && <Badge tone="amber" label="robots override (documented)" />}
        {source.useBrowserHeaders && <Badge tone="amber" label="browser headers" />}
        {source.needsJavaScript && <Badge tone="amber" label="needs JavaScript" />}
        {source.blocksAutomation && <Badge tone="rose" label="blocks automation" />}
        {source.safeForPersonalLowFrequencyFetching === false && (
          <Badge tone="rose" label="not marked safe to fetch" />
        )}
        <Badge label={`every ${source.crawlIntervalHours}h`} />
        <Badge label={`delay ${source.requestDelayMs}ms`} />
        <Badge label={`≤${source.maxPagesPerRun}p / ≤${source.maxDetailPagesPerRun}d`} />
        {dogCount > 0 && <Badge tone="emerald" label={`${dogCount} dogs stored`} />}
      </div>

      {(source.notes || source.sourceStatusNotes) && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
          {source.sourceStatusNotes ?? source.notes}
        </p>
      )}
      {source.nextDebugStep && (
        <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[12px] text-amber-800 ring-1 ring-amber-200">
          <strong>Next debugging step:</strong> {source.nextDebugStep}
        </p>
      )}

      {/* backfill / initialization state */}
      <div className="mt-3 rounded-xl bg-cream-50 p-3 ring-1 ring-cream-200">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-semibold uppercase tracking-wide text-ink-300">Backfill</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${backfillTone}`}>
            {source.backfillStatus === "never" ? "never backfilled" : source.backfillStatus}
          </span>
          {source.lastBackfillCompletedAt && (
            <span className="text-ink-500">
              {fmtRel(source.lastBackfillCompletedAt.toISOString())}
            </span>
          )}
          {source.backfillStatus !== "never" && (
            <>
              <span className="text-ink-700">
                reported {source.backfillListingsReported ?? "unknown"} · raw{" "}
                {source.backfillRawListingsExtracted ?? 0} · dupes{" "}
                {source.backfillDuplicateListingsDetected ?? 0} · unique{" "}
                {source.backfillUniqueListingsSaved ?? 0}
              </span>
              <span
                className={
                  source.backfillPaginationCompleted
                    ? "text-emerald-700"
                    : "font-semibold text-amber-700"
                }
              >
                pagination {source.backfillPaginationCompleted ? "complete" : "INCOMPLETE"}
              </span>
              <span
                className={
                  source.backfillDetailExtractionCompleted
                    ? "text-emerald-700"
                    : "font-semibold text-amber-700"
                }
              >
                details {source.backfillDetailExtractionCompleted ? "complete" : "INCOMPLETE"}
              </span>
            </>
          )}
          {source.enabled && !source.initializedForDailyMonitoring && (
            <span className="font-semibold text-amber-700">
              daily monitoring disabled until backfill succeeds
            </span>
          )}
        </div>
        {(source.backfillWarnings?.length ?? 0) > 0 && (
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[12px] text-amber-800">
            {source.backfillWarnings!.slice(0, 5).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {/* last run */}
      <div className="mt-2 rounded-xl bg-cream-50 p-3 ring-1 ring-cream-200">
        {!lastRun ? (
          <p className="text-[12px] text-ink-300">
            <span className="font-semibold uppercase tracking-wide">Runs</span> · never run.{" "}
            {source.enabled ? (
              <>
                Start with{" "}
                <code className="rounded bg-white px-1">npm run backfill -- --source {source.id}</code>
              </>
            ) : (
              "Enable + implement adapter to start."
            )}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold uppercase tracking-wide text-ink-300">
                Last {lastRun.runType} run
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${RUN_TONES[lastRun.status] ?? ""}`}
              >
                {lastRun.status}
              </span>
              {lastRun.confidenceScore != null && (
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                    lastRun.confidenceScore >= 0.85
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : lastRun.confidenceScore >= 0.6
                        ? "bg-amber-50 text-amber-700 ring-amber-200"
                        : "bg-rose-50 text-rose-700 ring-rose-200"
                  }`}
                >
                  confidence {lastRun.confidenceScore}
                </span>
              )}
              <span className="text-ink-500">{fmtRel(lastRun.startedAt.toISOString())}</span>
              {lastGoodRunAt && (
                <span className="text-ink-300">last good run {fmtRel(lastGoodRunAt)}</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-ink-700">
                {lastRun.dogsFound} dogs · {lastRun.newDogs} new · {lastRun.changedDogs} changed ·{" "}
                {lastRun.missingDogs} missing
              </span>
              <span className="text-ink-500">
                raw {lastRun.rawListingsExtracted} / dupes {lastRun.duplicatesDetected} / unique{" "}
                {lastRun.uniqueListingsSaved}
                {lastRun.listingsMissingStableIds > 0 &&
                  ` / ${lastRun.listingsMissingStableIds} weak IDs`}
              </span>
              <span className="text-ink-300">
                {lastRun.pagesVisited} pages / {lastRun.detailsSucceeded}✓
                {lastRun.detailsFailed > 0 ? ` ${lastRun.detailsFailed}✗` : ""} details
                {lastRun.totalListingsReportedBySource != null &&
                  ` · source reports ${lastRun.totalListingsReportedBySource}`}
                {lastRun.countMismatch ? " · COUNT MISMATCH" : ""}
              </span>
              <span
                className={
                  lastRun.paginationCompleted ? "text-emerald-700" : "font-semibold text-amber-700"
                }
              >
                pagination {lastRun.paginationCompleted ? "complete" : "INCOMPLETE"}
              </span>
              {!lastRun.missingUpdatesApplied &&
                lastRun.status !== "failed" &&
                lastRun.status !== "blocked" && (
                  <span className="font-semibold text-amber-700">stale statuses frozen</span>
                )}
            </div>
            {lastRun.errorMessage && (
              <p className="mt-1.5 text-[12px] font-medium text-rose-700">{lastRun.errorMessage}</p>
            )}
            {warnings.length > 0 && (
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[12px] text-amber-800">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {(lastRun.paginationTrace?.length ?? 0) > 0 && (
              <button
                onClick={() => setShowTrace(!showTrace)}
                className="mt-1.5 text-[11px] font-medium text-ink-300 underline underline-offset-2"
              >
                {showTrace ? "hide" : "show"} pagination trace
              </button>
            )}
            {showTrace && (
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[10px] leading-relaxed text-ink-500 ring-1 ring-cream-200">
                {(lastRun.paginationTrace ?? [])
                  .map((t) => `p${t.page}  ${t.resultCount} results  ${t.note ?? ""}  ${t.url}`)
                  .join("\n")}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone?: "amber" | "rose" | "emerald" }) {
  const tones = {
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 ring-1 ${tone ? tones[tone] : "bg-cream-50 text-ink-500 ring-cream-200"}`}
    >
      {label}
    </span>
  );
}
