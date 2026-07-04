import { and, desc, eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import type { ScoutDb } from "@/db";
import {
  adoptionSources,
  canonicalDogs,
  dogListings,
  sourceRuns,
  type AdoptionSourceRow,
  type DogListingRow,
  type NewDogListingRow,
} from "@/db/schema";
import { getAdapter } from "@/adapters";
import type { AdapterContext } from "@/adapters/types";
import { fetchJson, fetchPage } from "@/lib/fetchClient";
import { checkRobots } from "@/lib/robots";
import { markMissed, markSeen, isActive } from "@/lib/lifecycle";
import { buildCanonicalGroups, type CanonicalInput } from "@/lib/canonical";
import { normalizeBreed } from "@/lib/normalize";
import type { AdapterResult, RunStatus } from "@/lib/types";
import { confidenceScore } from "./confidence";
import {
  DETAIL_PRESERVED_FIELDS,
  carriesInformation,
  normalizeExtracted,
  recomputeContentHash,
} from "./normalizeExtracted";

/**
 * Ingestion runner — daily monitoring and full-inventory backfill.
 *
 * Every attempted source records a SourceRun with dedupe stats, pagination
 * trace, detail accounting, count comparison, and a rule-based confidence
 * score. Stale/missing lifecycle updates apply ONLY when a run conclusively
 * covered the source (success / success_with_warnings with completed
 * pagination) — failed, blocked, and partial runs never mark dogs missing.
 *
 * Daily runs are gated: a source that has never completed an acceptable
 * backfill is skipped (initializedForDailyMonitoring=false) so daily missing
 * detection can't run against an unknown baseline.
 */

export interface IngestOptions {
  now?: Date;
  /** Save raw page captures under data/raw/<source>/<runId>/ (CLI default: on). */
  saveRawDebug?: boolean;
  log?: (msg: string) => void;
  /** backfill = full-inventory initialization run; daily = routine monitoring. */
  mode?: "daily" | "backfill";
  /** Run a daily crawl even if the source was never backfilled. */
  force?: boolean;
}

export interface RunSummary {
  sourceId: string;
  sourceName: string;
  runType: "daily" | "backfill";
  skipped: boolean;
  skipReason?: string;
  status: RunStatus;
  dogsFound: number;
  rawListingsExtracted: number;
  duplicatesDetected: number;
  uniqueListingsSaved: number;
  listingsMissingStableIds: number;
  newDogs: number;
  changedDogs: number;
  unchangedDogs: number;
  missingDogs: number;
  unavailableDogs: number;
  warnings: string[];
  errorMessage: string | null;
  pagesVisited: number;
  detailPagesVisited: number;
  detailsAttempted: number;
  detailsSucceeded: number;
  detailsFailed: number;
  totalReportedBySource: number | null;
  countMismatch: boolean;
  paginationCompleted: boolean | null;
  missingUpdatesApplied: boolean;
  confidence: number;
  initializedForDailyMonitoring?: boolean;
  photosPresent: number;
  animalIdsPresent: number;
  durationMs: number;
}

/** How much of a listing-count drop (vs. the last good run) we treat as suspicious. */
const SHARP_DROP_RATIO = 0.5;
const SHARP_DROP_MIN_PRIOR = 10;
/** Detail failures beyond this fraction of dogs downgrade the run to partial. */
const DETAIL_FAILURE_RATIO = 0.2;

const GOOD_RUN_STATUSES: RunStatus[] = ["success", "success_with_warnings"];

export async function ingestSource(
  db: ScoutDb,
  sourceId: string,
  opts: IngestOptions = {}
): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const mode = opts.mode ?? "daily";
  const log = opts.log ?? ((m: string) => console.log(`  [${sourceId}] ${m}`));
  const startedAt = new Date();

  const source = await db
    .select()
    .from(adoptionSources)
    .where(eq(adoptionSources.id, sourceId))
    .get();
  if (!source) throw new Error(`unknown source: ${sourceId}`);

  const base: RunSummary = {
    sourceId,
    sourceName: source.name,
    runType: mode,
    skipped: false,
    status: "failed",
    dogsFound: 0,
    rawListingsExtracted: 0,
    duplicatesDetected: 0,
    uniqueListingsSaved: 0,
    listingsMissingStableIds: 0,
    newDogs: 0,
    changedDogs: 0,
    unchangedDogs: 0,
    missingDogs: 0,
    unavailableDogs: 0,
    warnings: [],
    errorMessage: null,
    pagesVisited: 0,
    detailPagesVisited: 0,
    detailsAttempted: 0,
    detailsSucceeded: 0,
    detailsFailed: 0,
    totalReportedBySource: null,
    countMismatch: false,
    paginationCompleted: null,
    missingUpdatesApplied: false,
    confidence: 0,
    photosPresent: 0,
    animalIdsPresent: 0,
    durationMs: 0,
  };

  if (!source.enabled) {
    return { ...base, skipped: true, skipReason: "source disabled" };
  }
  if (mode === "daily" && !source.initializedForDailyMonitoring && !opts.force) {
    return {
      ...base,
      skipped: true,
      skipReason:
        "not initialized for daily monitoring — run a backfill first (npm run backfill -- --source " +
        sourceId +
        ")",
    };
  }
  const adapter = getAdapter(source.adapterType);
  if (!adapter) {
    const msg = `no adapter implemented for adapterType "${source.adapterType}"`;
    await recordRun(db, source, startedAt, now, mode, { status: "failed", errorMessage: msg, warnings: [] });
    return { ...base, status: "failed", errorMessage: msg, durationMs: Date.now() - startedAt.getTime() };
  }

  // ---- robots.txt courtesy check (skipped for non-http mock schemes) ------
  const preWarnings: string[] = [];
  let effectiveDelayMs = source.requestDelayMs;
  if (/^https?:/i.test(source.listingUrl)) {
    const robots = await checkRobots(source.listingUrl, {
      browserHeaders: source.useBrowserHeaders,
    });
    await db
      .update(adoptionSources)
      .set({ robotsStatus: robots.status, robotsCheckedAt: now, updatedAt: now })
      .where(eq(adoptionSources.id, source.id))
      .run();
    if (robots.status === "disallows_listing_path") {
      if (source.robotsOverrideReason) {
        preWarnings.push(
          `robots.txt disallows the listing path (rule: ${robots.matchedRule}); proceeding under recorded operator override — see source notes`
        );
      } else {
        const msg = `robots.txt disallows the listing path (rule: ${robots.matchedRule}); source auto-disabled for review`;
        await db
          .update(adoptionSources)
          .set({
            enabled: false,
            safeForPersonalLowFrequencyFetching: false,
            sourceStatusNotes: msg,
            nextDebugStep:
              "Review robots.txt manually; if the disallow is intentional, leave disabled. Otherwise record a robotsOverrideReason in the registry.",
            updatedAt: now,
          })
          .where(eq(adoptionSources.id, source.id))
          .run();
        await recordRun(db, source, startedAt, now, mode, {
          status: "blocked",
          errorMessage: msg,
          warnings: [],
        });
        return {
          ...base,
          status: "blocked",
          errorMessage: msg,
          durationMs: Date.now() - startedAt.getTime(),
        };
      }
    }
    if (robots.crawlDelaySeconds != null) {
      effectiveDelayMs = Math.max(effectiveDelayMs, robots.crawlDelaySeconds * 1000);
    }
  }

  // ---- adapter context -----------------------------------------------------
  const existing = await db
    .select()
    .from(dogListings)
    .where(eq(dogListings.sourceId, source.id))
    .all();
  const existingByKey = new Map(existing.map((l) => [l.listingKey, l]));

  const runStamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const debugDir = path.join(process.cwd(), "data", "raw", source.id, runStamp);
  let debugSaved = false;

  const fetchDefaults = {
    requestDelayMs: effectiveDelayMs,
    timeoutMs: source.timeoutMs,
    retries: source.retryCount,
    browserHeaders: source.useBrowserHeaders,
  };
  const ctx: AdapterContext = {
    source,
    fetch: (url, o) => fetchPage(url, { ...fetchDefaults, ...o }),
    fetchJson: (url, o) => fetchJson(url, { ...fetchDefaults, ...o }),
    log,
    shouldFetchDetail: (listingKey, cardFingerprint) => {
      const prev = existingByKey.get(listingKey);
      if (!prev) return true;
      return !(prev.cardFingerprint === cardFingerprint && prev.detailFetchedAt != null);
    },
    limits: {
      maxPages: source.maxPagesPerRun,
      maxDetailPages: source.maxDetailPagesPerRun,
    },
    saveDebug: (name, content) => {
      if (opts.saveRawDebug === false) return;
      try {
        fs.mkdirSync(debugDir, { recursive: true });
        fs.writeFileSync(path.join(debugDir, name), content);
        debugSaved = true;
      } catch {
        /* best-effort */
      }
    },
  };

  // ---- crawl ---------------------------------------------------------------
  let result: AdapterResult;
  try {
    result = await adapter.crawl(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: RunStatus = /HTTP 403/.test(msg) ? "blocked" : "failed";
    await recordRun(db, source, startedAt, now, mode, {
      status,
      errorMessage: msg,
      warnings: preWarnings,
      parserVersion: adapter.parserVersion,
      rawDebugPath: debugSaved ? debugDir : null,
    });
    if (mode === "backfill") {
      await applyBackfillOutcome(db, source, now, startedAt, {
        status,
        reported: null,
        raw: 0,
        duplicates: 0,
        unique: 0,
        paginationCompleted: false,
        detailExtractionCompleted: false,
        warnings: [msg],
        initialized: false,
      });
    }
    log(`crawl ${status}: ${msg} — no listing updates applied`);
    return {
      ...base,
      status,
      errorMessage: msg,
      warnings: preWarnings,
      durationMs: Date.now() - startedAt.getTime(),
    };
  }

  const warnings = [...preWarnings, ...result.warnings];

  // ---- in-batch dedupe (same dog twice in one crawl) -------------------------
  const rawListingsExtracted = result.dogs.length;
  const byKey = new Map<string, NewDogListingRow>();
  let duplicatesDetected = 0;
  for (const dog of result.dogs) {
    const row = normalizeExtracted(source, dog, now);
    const prev = byKey.get(row.listingKey);
    if (!prev) {
      byKey.set(row.listingKey, row);
    } else {
      duplicatesDetected++;
      const richer =
        (row.detailFetchedAt ? 1 : 0) - (prev.detailFetchedAt ? 1 : 0) ||
        (row.biographyRaw?.length ?? 0) - (prev.biographyRaw?.length ?? 0);
      if (richer > 0) byKey.set(row.listingKey, row);
    }
  }
  if (duplicatesDetected > 0) {
    warnings.push(
      `${duplicatesDetected} duplicate listing(s) within the crawl were merged before writing (dedupe key: source animal id / original URL)`
    );
  }
  const listingsMissingStableIds = [...byKey.values()].filter(
    (r) => r.dedupeMethod !== "source_animal_id"
  ).length;
  if (byKey.size > 0 && listingsMissingStableIds / byKey.size > 0.2) {
    warnings.push(
      `${listingsMissingStableIds}/${byKey.size} listings lack a source animal id (deduping on original URL instead)`
    );
  }

  // ---- upsert ---------------------------------------------------------------
  let newDogs = 0;
  let changedDogs = 0;
  let unchangedDogs = 0;
  let unavailableDogs = 0;
  let photoLosses = 0;
  let photosPresent = 0;
  let animalIdsPresent = 0;
  const seenKeys = new Set<string>();

  await db.transaction(async (tx) => {
    for (const row of byKey.values()) {
      seenKeys.add(row.listingKey);
      if ((row.photoUrls?.length ?? 0) > 0) photosPresent++;
      if (row.dedupeMethod === "source_animal_id") animalIdsPresent++;
      if (row.statusNormalized === "adopted" || row.statusNormalized === "not_available") {
        unavailableDogs++;
      }
      const prev = existingByKey.get(row.listingKey);
      if (!prev) {
        await tx.insert(dogListings).values(row).run();
        newDogs++;
        continue;
      }

      // Card unchanged + detail previously fetched + detail skipped this run:
      // nothing new was observed, so the stored record is authoritative.
      // Touch only freshness bookkeeping.
      if (
        row.detailFetchedAt == null &&
        prev.detailFetchedAt != null &&
        row.cardFingerprint != null &&
        row.cardFingerprint === prev.cardFingerprint
      ) {
        unchangedDogs++;
        const lifecycle = markSeen(prev);
        await tx
          .update(dogListings)
          .set({ lastSeenAt: now, updatedAt: now, ...lifecycle })
          .where(eq(dogListings.id, prev.id))
          .run();
        continue;
      }

      // Otherwise merge: card-level data applies, but no-information values
      // (null / empty / "unknown") never clobber previously captured
      // detail-only fields.
      const merged = { ...row } as Record<string, unknown>;
      if (row.detailFetchedAt == null && prev.detailFetchedAt != null) {
        for (const f of DETAIL_PRESERVED_FIELDS) {
          const incoming = merged[f];
          const prior = (prev as Record<string, unknown>)[f];
          if (!carriesInformation(incoming) && carriesInformation(prior)) {
            merged[f] = prior;
          }
        }
        if (!row.photoUrls || row.photoUrls.length === 0) {
          merged.photoUrls = prev.photoUrls;
          merged.primaryPhotoUrl = merged.primaryPhotoUrl ?? prev.primaryPhotoUrl;
          merged.photoHash = prev.photoHash;
        }
        merged.detailFetchedAt = prev.detailFetchedAt;
        merged.contentHash = recomputeContentHash(merged);
      }

      const lifecycle = markSeen(prev);
      const hadPhotos = (prev.photoUrls?.length ?? 0) > 0;
      const hasPhotos = ((merged.photoUrls as string[] | null)?.length ?? 0) > 0;
      if (hadPhotos && !hasPhotos) photoLosses++;

      if (merged.contentHash !== prev.contentHash) {
        changedDogs++;
        await tx
          .update(dogListings)
          .set({
            ...(merged as NewDogListingRow),
            id: prev.id,
            firstSeenAt: prev.firstSeenAt, // never reset
            createdAt: prev.createdAt,
            canonicalDogId: prev.canonicalDogId,
            possibleDuplicateOf: prev.possibleDuplicateOf,
            duplicateConfidence: prev.duplicateConfidence,
            lastSeenAt: now,
            lastChangedAt: now,
            updatedAt: now,
            ...lifecycle,
          })
          .where(eq(dogListings.id, prev.id))
          .run();
      } else {
        unchangedDogs++;
        await tx
          .update(dogListings)
          .set({ lastSeenAt: now, updatedAt: now, ...lifecycle })
          .where(eq(dogListings.id, prev.id))
          .run();
      }
    }
  });

  const dogsFound = byKey.size;
  const countMismatch =
    result.totalReportedBySource != null && dogsFound !== result.totalReportedBySource;

  // ---- run classification -----------------------------------------------------
  let status: RunStatus = "success";
  if (dogsFound === 0) {
    status = "partial";
    warnings.push("run returned zero dogs — treating as partial; missing/stale statuses NOT updated");
  }
  if (!result.paginationCompleted) {
    status = "partial";
    warnings.push("pagination did not complete — missing/stale statuses NOT updated");
  }
  if (!result.detailExtractionCompleted && status === "success") status = "partial";
  if (
    result.detailsAttempted > 0 &&
    result.detailsFailed / result.detailsAttempted > DETAIL_FAILURE_RATIO
  ) {
    status = "partial";
    warnings.push(
      `detail extraction failed for ${result.detailsFailed}/${result.detailsAttempted} attempts`
    );
  }
  if (countMismatch) {
    warnings.push(
      `source reported ${result.totalReportedBySource} listings but ${dogsFound} were extracted`
    );
  }

  const priorGood = await db
    .select()
    .from(sourceRuns)
    .where(and(eq(sourceRuns.sourceId, source.id), inArray(sourceRuns.status, GOOD_RUN_STATUSES)))
    .orderBy(desc(sourceRuns.startedAt))
    .limit(1)
    .get();
  if (
    priorGood &&
    priorGood.dogsFound >= SHARP_DROP_MIN_PRIOR &&
    dogsFound < priorGood.dogsFound * SHARP_DROP_RATIO
  ) {
    status = "partial";
    warnings.push(
      `listing count dropped sharply (${priorGood.dogsFound} → ${dogsFound}); treating run as partial and NOT marking dogs missing`
    );
  }
  if (photoLosses > Math.max(3, dogsFound * 0.3)) {
    warnings.push(`photos disappeared for ${photoLosses} previously-photographed dogs`);
  }
  if (status === "success" && warnings.length > 0) status = "success_with_warnings";

  // ---- missing/stale lifecycle (conclusive runs only) --------------------------
  let missingDogs = 0;
  const missingUpdatesApplied = GOOD_RUN_STATUSES.includes(status);
  if (missingUpdatesApplied) {
    await db.transaction(async (tx) => {
      for (const prev of existing) {
        if (seenKeys.has(prev.listingKey)) continue;
        const next = markMissed(
          {
            staleStatus: prev.staleStatus,
            missedRunCount: prev.missedRunCount,
            missingSince: prev.missingSince,
          },
          now
        );
        missingDogs++;
        await tx
          .update(dogListings)
          .set({ ...next, updatedAt: now })
          .where(eq(dogListings.id, prev.id))
          .run();
      }
    });
  } else {
    const unseen = existing.filter((l) => !seenKeys.has(l.listingKey)).length;
    if (unseen > 0) {
      warnings.push(
        `${unseen} previously-seen listings were absent, but run status is "${status}" so their stale status was left untouched`
      );
    }
  }

  // ---- confidence ----------------------------------------------------------------
  const confidence = confidenceScore({
    status,
    dogsFound,
    paginationCompleted: result.paginationCompleted,
    detailExtractionCompleted: result.detailExtractionCompleted,
    detailsAttempted: result.detailsAttempted,
    detailsFailed: result.detailsFailed,
    totalReportedBySource: result.totalReportedBySource,
    countMismatch,
    listingsMissingStableIds,
    photosPresent,
    originalUrlsPresent: dogsFound, // originalUrl is required by the adapter contract
    warningsCount: warnings.length,
  });

  // ---- record run -------------------------------------------------------------------
  await recordRun(db, source, startedAt, now, mode, {
    status,
    errorMessage: null,
    warnings,
    parserVersion: adapter.parserVersion,
    listingsFound: rawListingsExtracted,
    dogsFound,
    newDogs,
    changedDogs,
    unchangedDogs,
    unavailableDogs,
    missingDogs,
    htmlHash: result.htmlHash,
    pagesVisited: result.pagesVisited,
    detailPagesVisited: result.detailPagesVisited,
    totalListingsReportedBySource: result.totalReportedBySource,
    paginationCompleted: result.paginationCompleted,
    detailExtractionCompleted: result.detailExtractionCompleted,
    paginationTrace: result.paginationTrace,
    rawDebugPath: debugSaved ? debugDir : null,
    missingUpdatesApplied,
    rawListingsExtracted,
    duplicatesDetected,
    uniqueListingsSaved: dogsFound,
    listingsMissingStableIds,
    detailsAttempted: result.detailsAttempted,
    detailsSucceeded: result.detailsSucceeded,
    detailsFailed: result.detailsFailed,
    countMismatch,
    confidenceScore: confidence,
  });
  await db
    .update(adoptionSources)
    .set({ parserVersion: adapter.parserVersion, updatedAt: now })
    .where(eq(adoptionSources.id, source.id))
    .run();

  // ---- backfill bookkeeping -----------------------------------------------------------
  let initialized: boolean | undefined;
  if (mode === "backfill") {
    // A backfill initializes daily monitoring when it conclusively enumerated
    // the inventory: pagination complete + dogs found + not failed/blocked.
    // Detail-page gaps surface as warnings but don't block initialization
    // (missing detection only needs the complete card set).
    // (failed/blocked crawls returned earlier; here status is success/sww/partial)
    initialized = result.paginationCompleted === true && dogsFound > 0;
    await applyBackfillOutcome(db, source, now, startedAt, {
      status,
      reported: result.totalReportedBySource,
      raw: rawListingsExtracted,
      duplicates: duplicatesDetected,
      unique: dogsFound,
      paginationCompleted: result.paginationCompleted,
      detailExtractionCompleted: result.detailExtractionCompleted,
      warnings,
      initialized,
    });
  }

  return {
    ...base,
    status,
    dogsFound,
    rawListingsExtracted,
    duplicatesDetected,
    uniqueListingsSaved: dogsFound,
    listingsMissingStableIds,
    newDogs,
    changedDogs,
    unchangedDogs,
    missingDogs,
    unavailableDogs,
    warnings,
    errorMessage: null,
    pagesVisited: result.pagesVisited,
    detailPagesVisited: result.detailPagesVisited,
    detailsAttempted: result.detailsAttempted,
    detailsSucceeded: result.detailsSucceeded,
    detailsFailed: result.detailsFailed,
    totalReportedBySource: result.totalReportedBySource,
    countMismatch,
    paginationCompleted: result.paginationCompleted,
    missingUpdatesApplied,
    confidence,
    initializedForDailyMonitoring: initialized,
    photosPresent,
    animalIdsPresent,
    durationMs: Date.now() - startedAt.getTime(),
  };
}

async function applyBackfillOutcome(
  db: ScoutDb,
  source: AdoptionSourceRow,
  now: Date,
  startedAt: Date,
  o: {
    status: RunStatus;
    reported: number | null;
    raw: number;
    duplicates: number;
    unique: number;
    paginationCompleted: boolean | null;
    detailExtractionCompleted: boolean | null;
    warnings: string[];
    initialized: boolean;
  }
) {
  await db
    .update(adoptionSources)
    .set({
      backfillStatus: o.status,
      lastBackfillStartedAt: startedAt,
      lastBackfillCompletedAt: now,
      backfillListingsReported: o.reported,
      backfillRawListingsExtracted: o.raw,
      backfillDuplicateListingsDetected: o.duplicates,
      backfillUniqueListingsSaved: o.unique,
      backfillPaginationCompleted: o.paginationCompleted,
      backfillDetailExtractionCompleted: o.detailExtractionCompleted,
      backfillWarnings: o.warnings,
      initializedForDailyMonitoring: o.initialized,
      updatedAt: now,
    })
    .where(eq(adoptionSources.id, source.id))
    .run();
}

interface RecordRunExtras {
  status: RunStatus;
  errorMessage: string | null;
  warnings: string[];
  parserVersion?: string;
  listingsFound?: number;
  dogsFound?: number;
  newDogs?: number;
  changedDogs?: number;
  unchangedDogs?: number;
  unavailableDogs?: number;
  missingDogs?: number;
  htmlHash?: string | null;
  pagesVisited?: number;
  detailPagesVisited?: number;
  totalListingsReportedBySource?: number | null;
  paginationCompleted?: boolean | null;
  detailExtractionCompleted?: boolean | null;
  paginationTrace?: AdapterResult["paginationTrace"];
  rawDebugPath?: string | null;
  missingUpdatesApplied?: boolean;
  rawListingsExtracted?: number;
  duplicatesDetected?: number;
  uniqueListingsSaved?: number;
  listingsMissingStableIds?: number;
  detailsAttempted?: number;
  detailsSucceeded?: number;
  detailsFailed?: number;
  countMismatch?: boolean;
  confidenceScore?: number;
}

async function recordRun(
  db: ScoutDb,
  source: AdoptionSourceRow,
  startedAt: Date,
  finishedAt: Date,
  runType: "daily" | "backfill",
  extras: RecordRunExtras
) {
  await db
    .insert(sourceRuns)
    .values({
      sourceId: source.id,
      runType,
      startedAt,
      finishedAt,
      status: extras.status,
      errorMessage: extras.errorMessage,
      warnings: extras.warnings,
      parserVersion: extras.parserVersion ?? null,
      listingsFound: extras.listingsFound ?? 0,
      dogsFound: extras.dogsFound ?? 0,
      newDogs: extras.newDogs ?? 0,
      changedDogs: extras.changedDogs ?? 0,
      unchangedDogs: extras.unchangedDogs ?? 0,
      unavailableDogs: extras.unavailableDogs ?? 0,
      missingDogs: extras.missingDogs ?? 0,
      htmlHash: extras.htmlHash ?? null,
      pagesVisited: extras.pagesVisited ?? 0,
      detailPagesVisited: extras.detailPagesVisited ?? 0,
      totalListingsReportedBySource: extras.totalListingsReportedBySource ?? null,
      paginationCompleted: extras.paginationCompleted ?? null,
      detailExtractionCompleted: extras.detailExtractionCompleted ?? null,
      paginationTrace: extras.paginationTrace ?? [],
      rawDebugPath: extras.rawDebugPath ?? null,
      missingUpdatesApplied: extras.missingUpdatesApplied ?? false,
      rawListingsExtracted: extras.rawListingsExtracted ?? 0,
      duplicatesDetected: extras.duplicatesDetected ?? 0,
      uniqueListingsSaved: extras.uniqueListingsSaved ?? 0,
      listingsMissingStableIds: extras.listingsMissingStableIds ?? 0,
      detailsAttempted: extras.detailsAttempted ?? 0,
      detailsSucceeded: extras.detailsSucceeded ?? 0,
      detailsFailed: extras.detailsFailed ?? 0,
      countMismatch: extras.countMismatch ?? null,
      confidenceScore: extras.confidenceScore ?? null,
    })
    .run();
}

/** Ingest every enabled source, sequentially (politeness), then regroup duplicates. */
export async function ingestAllEnabled(
  db: ScoutDb,
  opts: IngestOptions = {}
): Promise<RunSummary[]> {
  const sources = await db
    .select()
    .from(adoptionSources)
    .where(eq(adoptionSources.enabled, true))
    .all();
  const summaries: RunSummary[] = [];
  for (const s of sources) {
    summaries.push(await ingestSource(db, s.id, opts));
  }
  await rebuildCanonicalGroups(db, opts.now ?? new Date());
  return summaries;
}

/**
 * Rebuild cross-listing canonical groups (over-dedupe by policy) and flag
 * possible duplicates for review. Deterministic and idempotent.
 */
export async function rebuildCanonicalGroups(db: ScoutDb, now: Date = new Date()): Promise<number> {
  const listings = await db.select().from(dogListings).all();
  const byId = new Map(listings.map((l) => [l.id, l]));
  const inputs: CanonicalInput[] = listings.map((l: DogListingRow) => ({
    id: l.id,
    sourceId: l.sourceId,
    name: l.name,
    sex: l.sex,
    breedTokens: normalizeBreed(l.breedRaw ?? l.breedNormalized).tokens,
    ageMonthsEstimate: l.ageMonthsEstimate,
    primaryPhotoUrl: l.primaryPhotoUrl,
    lastSeenAt: l.lastSeenAt,
    hasPhoto: (l.photoUrls?.length ?? 0) > 0,
    bioLength: l.biographyRaw?.length ?? 0,
    isActive: isActive(l.staleStatus),
  }));
  const groups = buildCanonicalGroups(inputs);

  await db.transaction(async (tx) => {
    await tx.delete(canonicalDogs).run();
    // Clear stale duplicate flags, then re-apply from fresh groups.
    await tx
      .update(dogListings)
      .set({ possibleDuplicateOf: null, duplicateConfidence: null })
      .run();
    for (const g of groups) {
      const inserted = await tx
        .insert(canonicalDogs)
        .values({
          mergeKey: g.mergeKey,
          displayListingId: g.displayListingId,
          displayName: null,
          listingCount: g.listingIds.length,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: canonicalDogs.id })
        .get();
      await tx
        .update(dogListings)
        .set({ canonicalDogId: inserted.id })
        .where(inArray(dogListings.id, g.listingIds))
        .run();
      // Duplicate audit trail: non-display members point at the display
      // listing with a rough rule-based confidence (never auto-merged data).
      if (g.listingIds.length > 1) {
        const display = byId.get(g.displayListingId);
        for (const id of g.listingIds) {
          if (id === g.displayListingId) continue;
          const member = byId.get(id);
          let conf = 0.6;
          if (
            member?.primaryPhotoUrl &&
            display?.primaryPhotoUrl &&
            member.primaryPhotoUrl === display.primaryPhotoUrl
          ) {
            conf = 0.95;
          } else if (member?.sourceId === display?.sourceId) {
            conf = 0.85;
          }
          await tx
            .update(dogListings)
            .set({ possibleDuplicateOf: g.displayListingId, duplicateConfidence: conf })
            .where(eq(dogListings.id, id))
            .run();
        }
      }
    }
  });
  return groups.length;
}
