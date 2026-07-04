/**
 * Overnight Scout CLI — pull fresh listings, re-run every standing watch, and
 * text an SMS alert when a genuinely new match appears.
 *
 *   npm run scout:overnight                 # full run (ingest + evaluate + text)
 *   npm run scout:overnight -- --dry-run    # evaluate + log, send/record nothing
 *   npm run scout:overnight -- --no-ingest  # skip scraping, just re-check the DB
 *
 * Wire it to cron for a true overnight run, e.g. (2:15am nightly):
 *   15 2 * * *  cd /path/to/scout && /usr/local/bin/npm run scout:overnight >> data/overnight.log 2>&1
 */
import { parseArgs } from "node:util";
import { createDb } from "@/db";
import { runOvernight } from "@/ingest/overnight";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-ingest": { type: "boolean", default: false },
  },
});

async function main() {
  const db = createDb();
  const summary = await runOvernight(db, {
    ingest: !args["no-ingest"],
    dryRun: !!args["dry-run"],
    log: (m) => console.log(m),
  });

  console.log("\n── summary ──");
  console.log(
    `sources ingested: ${summary.ingestedSources} · watches: ${summary.watchesChecked} · ` +
      `new matches: ${summary.newMatchesFound} · alerts: ${summary.alertsSent} · ` +
      `texts sent: ${summary.textsSent}`
  );
  for (const w of summary.perWatch) {
    console.log(`  • ${w.label}: ${w.found} new → ${w.alerted} alerted` + (w.curatedByAgent ? " (curated)" : ""));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("overnight run failed:", err);
    process.exit(1);
  });
