import { eq } from "drizzle-orm";
import type { ScoutDb } from "@/db";
import { watches, watchNotifications } from "@/db/schema";
import { buildDogViews } from "@/lib/dogView";
import type { SearchMatch } from "@/lib/aiSearch";
import {
  buildAiIndex,
  evaluateWatch,
  selectNewMatches,
  type WatchLike,
} from "@/lib/watchEval";
import { curateWatchAlerts, hasManagedAgent, type CuratedAlert } from "@/lib/managedAgent";
import { hasSms, sendSms } from "@/lib/sms";
import { isPlaceholderName } from "@/lib/normalize";
import { ingestAllEnabled } from "@/ingest/runner";

/**
 * The overnight scout. Pulls fresh listings, re-runs every standing watch,
 * finds genuinely NEW adoptable matches (never re-alerting a dog), lets the
 * Managed Agent curator judge which are worth flagging (falling back to the
 * deterministic ranking), and texts the owner one SMS per new match.
 *
 * Designed to run headless on a schedule (`npm run scout:overnight`, wired to
 * cron) and to degrade cleanly: no watches → no-op; no Twilio keys → logs only;
 * no Managed Agent → deterministic selection; --dry-run → evaluate without
 * sending or recording. The deterministic core needs no network beyond ingestion.
 */

export interface OvernightOptions {
  /** Pull fresh listings before evaluating (default true). */
  ingest?: boolean;
  /** Evaluate + log but send nothing and record nothing (default false). */
  dryRun?: boolean;
  log?: (msg: string) => void;
  now?: Date;
  /** Max notifications per watch per run, so a big intake can't flood (default 5). */
  perWatchCap?: number;
}

export interface OvernightWatchResult {
  watchId: number;
  label: string;
  found: number;
  alerted: number;
  curatedByAgent: boolean;
}

export interface OvernightSummary {
  ingestedSources: number;
  watchesChecked: number;
  newMatchesFound: number;
  alertsSent: number;
  textsSent: number;
  perWatch: OvernightWatchResult[];
}

/** The alert text — e.g. "Scout found Jackson, a blue heeler that matches your
 *  search. https://…". Kept close to a human note, one dog per message. Dogs
 *  whose "name" is really a shelter ID (A5785550) drop the name gracefully. */
function smsBody(m: SearchMatch): string {
  const d = m.dog;
  const breed = d.breedNormalized ?? d.breedRaw ?? "dog";
  const article = /^[aeiou]/i.test(breed) ? "an" : "a";
  const lead =
    d.name && !isPlaceholderName(d.name)
      ? `Scout found ${d.name}, ${article} ${breed}`
      : `Scout found ${article} ${breed}`;
  return `${lead} that matches your search. ${d.originalUrl}`;
}

export async function runOvernight(
  db: ScoutDb,
  opts: OvernightOptions = {}
): Promise<OvernightSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const cap = opts.perWatchCap ?? 5;

  const summary: OvernightSummary = {
    ingestedSources: 0,
    watchesChecked: 0,
    newMatchesFound: 0,
    alertsSent: 0,
    textsSent: 0,
    perWatch: [],
  };

  // 1 — pull fresh listings (unless skipped, e.g. testing or a re-check).
  if (opts.ingest ?? true) {
    log("Pulling fresh listings…");
    const runs = await ingestAllEnabled(db, { mode: "daily", now, log: (m) => log(`  ${m}`) });
    summary.ingestedSources = runs.length;
    const newDogs = runs.reduce((n, r) => n + r.newDogs, 0);
    log(`Ingested ${runs.length} sources · ${newDogs} newly listed dogs.`);
  }

  const activeWatches = db.select().from(watches).where(eq(watches.active, true)).all();
  if (!activeWatches.length) {
    log("No active watches — nothing to check.");
    return summary;
  }

  const dogs = buildDogViews(db, now);
  const aiByDog = buildAiIndex(dogs);
  const usingAgent = hasManagedAgent();
  log(
    `Checking ${activeWatches.length} watch(es) against ${dogs.length} dogs` +
      ` · curator: ${usingAgent ? "Managed Agent" : "deterministic"}` +
      ` · sms: ${hasSms() ? "on" : "off (logging only)"}${dryRun ? " · DRY RUN" : ""}`
  );

  for (const w of activeWatches) {
    summary.watchesChecked += 1;
    const watchLike: WatchLike = {
      id: w.id,
      query: w.query,
      parsed: w.parsed,
      latitude: w.latitude,
      longitude: w.longitude,
    };
    const ranked = evaluateWatch(watchLike, dogs, aiByDog);

    const notifiedRows = db
      .select({ dogListingId: watchNotifications.dogListingId })
      .from(watchNotifications)
      .where(eq(watchNotifications.watchId, w.id))
      .all();
    const alreadyNotified = new Set(notifiedRows.map((r) => r.dogListingId));

    const fresh = selectNewMatches(ranked, { alreadyNotified });
    summary.newMatchesFound += fresh.length;

    if (!fresh.length) {
      if (!dryRun) db.update(watches).set({ lastCheckedAt: now }).where(eq(watches.id, w.id)).run();
      summary.perWatch.push({ watchId: w.id, label: w.label, found: 0, alerted: 0, curatedByAgent: false });
      log(`  "${w.label}": no new matches.`);
      continue;
    }

    // Let the Managed Agent judge which new matches are worth a text; fall back
    // to the deterministic ranking. The message copy is the same simple template
    // either way, so a curator outage never changes what the owner reads.
    const curated: CuratedAlert[] | null = await curateWatchAlerts(w.query, fresh);
    const byId = new Map(fresh.map((m) => [m.dog.id, m]));
    const curatedByAgent = !!(curated && curated.length);

    const selected: SearchMatch[] = (
      curatedByAgent
        ? curated!.map((c) => byId.get(c.id)).filter((m): m is SearchMatch => !!m)
        : fresh
    ).slice(0, cap);

    log(
      `  "${w.label}": ${fresh.length} new · alerting ${selected.length}` +
        ` (${curatedByAgent ? "curated" : "deterministic"})`
    );

    let alerted = 0;
    for (const m of selected) {
      const d = m.dog;
      const body = smsBody(m);
      log(`    → ${body}`);

      if (dryRun) {
        alerted += 1;
        continue;
      }

      if ((await sendSms(body)) === "ok") summary.textsSent += 1;
      db.insert(watchNotifications)
        .values({
          watchId: w.id,
          dogListingId: d.id,
          notifiedAt: now,
          score: m.score,
          curatedByAgent,
        })
        .onConflictDoNothing()
        .run();
      alerted += 1;
    }

    summary.alertsSent += alerted;
    if (!dryRun) {
      db.update(watches)
        .set({
          lastCheckedAt: now,
          ...(alerted > 0
            ? { lastNotifiedAt: now, notifiedCount: w.notifiedCount + alerted }
            : {}),
        })
        .where(eq(watches.id, w.id))
        .run();
    }
    summary.perWatch.push({
      watchId: w.id,
      label: w.label,
      found: fresh.length,
      alerted,
      curatedByAgent,
    });
  }

  log(
    `Done: ${summary.newMatchesFound} new match(es) across ${summary.watchesChecked} watch(es);` +
      ` ${summary.alertsSent} alert(s); ${summary.textsSent} text(s) sent.`
  );
  return summary;
}
