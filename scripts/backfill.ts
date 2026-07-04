/**
 * Full current-inventory backfill. A source is not trusted for daily
 * monitoring until it has completed an acceptable backfill (pagination
 * complete + dogs found + not failed/blocked).
 *
 *   npm run backfill -- --source laas            # one source
 *   npm run backfill -- --all                    # every enabled source
 *   npm run backfill -- --priority               # critical/high priority enabled sources
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { adoptionSources } from "@/db/schema";
import { ingestSource, rebuildCanonicalGroups, type RunSummary } from "@/ingest/runner";

const { values: args } = parseArgs({
  options: {
    source: { type: "string", multiple: true },
    all: { type: "boolean", default: false },
    priority: { type: "boolean", default: false },
    "no-debug": { type: "boolean", default: false },
  },
});

function fmt(s: RunSummary): string {
  if (s.skipped) return `Backfill ${s.sourceId}: skipped (${s.skipReason})`;
  const lines = [
    `Backfilled ${s.sourceId}:`,
    `  - source reported ${s.totalReportedBySource ?? "unknown total"}`,
    `  - raw listings extracted: ${s.rawListingsExtracted}`,
    `  - duplicates detected within run: ${s.duplicatesDetected}`,
    `  - unique dogs: ${s.uniqueListingsSaved}`,
    `  - existing updated: ${s.changedDogs + s.unchangedDogs}`,
    `  - new created: ${s.newDogs}`,
    `  - visited ${s.pagesVisited} listing pages, ${s.detailPagesVisited} detail pages` +
      (s.detailsFailed ? ` (${s.detailsFailed} detail failures)` : ""),
    `  - ${s.uniqueListingsSaved} original URLs present, ${s.animalIdsPresent} animal IDs present, ${s.photosPresent} photos present`,
    `  - dedupe method: ${s.listingsMissingStableIds === 0 ? "sourceAnimalId" : `sourceAnimalId (${s.listingsMissingStableIds} fell back to originalUrl)`}`,
    `  - pagination ${s.paginationCompleted ? "complete" : "INCOMPLETE"}, confidence ${s.confidence}`,
    `  - status: ${s.status}${s.errorMessage ? ` — ${s.errorMessage}` : ""}`,
    `  - initialized for daily monitoring: ${s.initializedForDailyMonitoring ? "YES" : "NO"}`,
  ];
  for (const w of s.warnings) lines.push(`  warning: ${w}`);
  return lines.join("\n");
}

async function main() {
  const db = createDb();
  let ids: string[] = [];
  if (args.source?.length) {
    ids = args.source;
  } else if (args.all || args.priority) {
    const sources = db
      .select()
      .from(adoptionSources)
      .where(eq(adoptionSources.enabled, true))
      .all();
    ids = sources
      .filter((s) => !args.priority || s.priority === "critical" || s.priority === "high")
      .map((s) => s.id);
  } else {
    console.log("Usage: npm run backfill -- --source <id> | --all | --priority");
    process.exit(2);
  }

  console.log(`Backfilling ${ids.length} source(s): ${ids.join(", ")}\n`);
  const summaries: RunSummary[] = [];
  for (const id of ids) {
    const s = await ingestSource(db, id, {
      mode: "backfill",
      saveRawDebug: !args["no-debug"],
    });
    summaries.push(s);
    console.log(fmt(s) + "\n");
  }
  rebuildCanonicalGroups(db);

  const initialized = summaries.filter((s) => s.initializedForDailyMonitoring).length;
  const failed = summaries.filter((s) => s.status === "failed" || s.status === "blocked").length;
  console.log(
    `Done: ${initialized}/${summaries.length} sources initialized for daily monitoring, ${failed} failed/blocked.`
  );
  process.exit(failed === summaries.length && summaries.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
