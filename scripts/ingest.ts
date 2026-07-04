/**
 * Ingestion CLI.
 *
 *   npm run ingest -- --source 24pc_santa_cruz     # one source
 *   npm run ingest -- --source a --source b        # several
 *   npm run ingest -- --all                        # all enabled sources
 *   npm run ingest -- --list                       # show registry status
 */
import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { createDb } from "@/db";
import { adoptionSources, sourceRuns } from "@/db/schema";
import { ingestAllEnabled, ingestSource, rebuildCanonicalGroups, type RunSummary } from "@/ingest/runner";

const { values: args } = parseArgs({
  options: {
    source: { type: "string", multiple: true },
    all: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    "no-debug": { type: "boolean", default: false },
  },
});

function fmtSummary(s: RunSummary): string {
  if (s.skipped) return `- ${s.sourceId}: skipped (${s.skipReason})`;
  if (s.status === "failed" || s.status === "blocked")
    return `- ${s.sourceId}: ${s.status.toUpperCase()} — ${s.errorMessage}`;
  const bits = [
    `${s.dogsFound} dogs found`,
    `${s.newDogs} new`,
    `${s.changedDogs} changed`,
  ];
  if (s.duplicatesDetected > 0) bits.push(`${s.duplicatesDetected} in-run duplicates merged`);
  if (s.missingDogs > 0) bits.push(`${s.missingDogs} missing`);
  if (s.unavailableDogs > 0) bits.push(`${s.unavailableDogs} listed-unavailable`);
  if (s.totalReportedBySource != null) bits.push(`source reports ${s.totalReportedBySource}`);
  bits.push(
    `${s.pagesVisited}p/${s.detailPagesVisited}d pages`,
    `conf ${s.confidence}`,
    `${(s.durationMs / 1000).toFixed(1)}s`
  );
  let line = `- ${s.sourceId}: ${s.status}, ${bits.join(", ")}`;
  if (!s.missingUpdatesApplied) {
    line += " [missing/stale statuses not updated]";
  }
  for (const w of s.warnings) line += `\n    warning: ${w}`;
  return line;
}

async function main() {
  const db = await createDb();

  if (args.list) {
    const sources = await db.select().from(adoptionSources).all();
    if (sources.length === 0) {
      console.log("No sources seeded yet — run `npm run seed` first.");
      return;
    }
    for (const s of sources) {
      const lastRun = await db
        .select()
        .from(sourceRuns)
        .where(eq(sourceRuns.sourceId, s.id))
        .orderBy(desc(sourceRuns.startedAt))
        .limit(1)
        .get();
      const state = s.enabled ? "enabled " : "disabled";
      const last = lastRun
        ? `last run ${lastRun.status} (${lastRun.dogsFound} dogs) ${lastRun.startedAt.toISOString().slice(0, 16)}`
        : "never run";
      console.log(`${state}  ${s.id.padEnd(26)} ${s.sourceSystem.padEnd(16)} ${last}`);
    }
    return;
  }

  const opts = { saveRawDebug: !args["no-debug"] };
  let summaries: RunSummary[] = [];

  if (args.all) {
    summaries = await ingestAllEnabled(db, opts);
  } else if (args.source?.length) {
    for (const id of args.source) {
      summaries.push(await ingestSource(db, id, opts));
    }
    await rebuildCanonicalGroups(db);
  } else {
    console.log("Usage: npm run ingest -- --source <id> [--source <id>…] | --all | --list");
    process.exit(2);
  }

  const attempted = summaries.filter((s) => !s.skipped);
  const skippedUninit = summaries.filter((s) => s.skipped && /not initialized/.test(s.skipReason ?? ""));
  console.log(`\nRan ${attempted.length} source${attempted.length === 1 ? "" : "s"}:`);
  for (const s of summaries) console.log(fmtSummary(s));

  const count = (st: string) => attempted.filter((s) => s.status === st).length;
  const totals = attempted.reduce(
    (acc, s) => ({
      raw: acc.raw + s.rawListingsExtracted,
      dupes: acc.dupes + s.duplicatesDetected,
      unique: acc.unique + s.uniqueListingsSaved,
      newDogs: acc.newDogs + s.newDogs,
      changed: acc.changed + s.changedDogs,
      updated: acc.updated + s.changedDogs + s.unchangedDogs,
      missing: acc.missing + s.missingDogs,
    }),
    { raw: 0, dupes: 0, unique: 0, newDogs: 0, changed: 0, updated: 0, missing: 0 }
  );
  console.log(
    `\nTotals: ${totals.raw} raw extracted, ${totals.dupes} duplicates merged, ${totals.unique} unique dogs, ` +
      `${totals.newDogs} new, ${totals.updated} existing updated (${totals.changed} changed), ${totals.missing} newly missing.`
  );
  console.log(
    `Statuses: ${count("success")} success, ${count("success_with_warnings")} with warnings, ` +
      `${count("partial")} partial, ${count("failed")} failed, ${count("blocked")} blocked` +
      (skippedUninit.length
        ? `; ${skippedUninit.length} skipped pending backfill (${skippedUninit.map((s) => s.sourceId).join(", ")})`
        : "")
  );
  const failed = count("failed") + count("blocked");
  process.exit(failed === attempted.length && attempted.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
