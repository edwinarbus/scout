/**
 * Daily "refresh" — the unit you point cron/launchd at so nothing is run by
 * hand. It does two things, in order, against the LOCAL database:
 *   1. Ingest all initialized sources (no API key needed).
 *   2. Precompute Claude vision enrichment for new/changed photos — but only
 *      if an Anthropic credential is present; otherwise it's skipped cleanly
 *      so the cron job never errors on machines without a key.
 *
 * Both steps must run where the SQLite DB lives (this machine / wherever the
 * app is deployed), which is why this is a scheduled local job rather than a
 * Claude Managed Agent — an Anthropic-hosted agent container can't reach a
 * local DB, and vision tagging is a batch of single calls with no agent loop.
 *
 *   npm run refresh
 *   # cron (7am daily):  0 7 * * * cd ~/scout && npm run refresh >> data/refresh.log 2>&1
 */
import { createDb } from "@/db";
import { ingestAllEnabled } from "@/ingest/runner";
import { enrichDogs } from "@/ingest/enrich";
import { hasAnthropicCredential, VISION_MODEL } from "@/lib/anthropic";

async function main() {
  const db = createDb();
  const startedAt = Date.now();

  console.log("=== Scout refresh: ingesting enabled sources ===");
  const runs = await ingestAllEnabled(db);
  const attempted = runs.filter((r) => !r.skipped);
  const ok = attempted.filter((r) => r.status === "success" || r.status === "success_with_warnings").length;
  const newDogs = attempted.reduce((n, r) => n + r.newDogs, 0);
  console.log(`Ingest: ${ok}/${attempted.length} sources ok, ${newDogs} new dogs.`);

  if (hasAnthropicCredential()) {
    console.log(`\n=== Scout refresh: enriching new/changed photos (${VISION_MODEL}) ===`);
    const e = await enrichDogs(db);
    console.log(`Enrich: ${e.analyzed} analyzed, ${e.skippedCached} cached, ${e.failed} failed.`);
  } else {
    console.log(
      "\nEnrichment skipped: no ANTHROPIC_API_KEY (set it, or `ant auth login`, to enable AI photo reads)."
    );
  }

  console.log(`\nRefresh done in ${((Date.now() - startedAt) / 1000).toFixed(0)}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
