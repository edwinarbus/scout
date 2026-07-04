/**
 * Precompute Claude vision enrichment for dog photos (run in advance).
 *
 * Requires an Anthropic API key. Provide it one of two ways:
 *   export ANTHROPIC_API_KEY=sk-ant-...      # then: npm run enrich -- --all
 *   ANTHROPIC_API_KEY=sk-ant-... npm run enrich -- --all
 * (or `ant auth login` once, which the SDK also picks up).
 *
 *   npm run enrich -- --all                 # every dog with a photo, cached
 *   npm run enrich -- --source laas         # one source
 *   npm run enrich -- --limit 20            # cap this run (great for a trial)
 *   npm run enrich -- --all --force         # re-analyze even cached photos
 *   npm run enrich -- --all --concurrency 6
 *
 * One image per dog (the primary photo), compressed to a small JPEG before
 * sending. Results cache by photo hash, so re-runs only analyze changed photos.
 * Model defaults to Haiku 4.5 (SCOUT_VISION_MODEL=claude-opus-4-8 to upgrade).
 */
import { parseArgs } from "node:util";
import { createDb } from "@/db";
import { enrichDogs } from "@/ingest/enrich";
import { hasAnthropicCredential, VISION_MODEL } from "@/lib/anthropic";

const { values: args } = parseArgs({
  options: {
    all: { type: "boolean", default: false },
    source: { type: "string" },
    limit: { type: "string" },
    force: { type: "boolean", default: false },
    concurrency: { type: "string" },
  },
});

async function main() {
  if (!args.all && !args.source) {
    console.log("Usage: npm run enrich -- --all | --source <id> [--limit N] [--force] [--concurrency N]");
    process.exit(2);
  }
  if (!hasAnthropicCredential()) {
    console.error(
      "No Anthropic credential found.\n" +
        "  Set one before running vision enrichment:\n" +
        "    export ANTHROPIC_API_KEY=sk-ant-...\n" +
        "  (or run `ant auth login` once — the SDK also reads that profile).\n"
    );
    process.exit(1);
  }

  const db = createDb();
  console.log(`Vision model: ${VISION_MODEL}\n`);
  const summary = await enrichDogs(db, {
    sourceId: args.source,
    limit: args.limit ? parseInt(args.limit, 10) : undefined,
    force: args.force,
    concurrency: args.concurrency ? parseInt(args.concurrency, 10) : undefined,
  });

  console.log(
    `\nEnriched ${summary.analyzed} dogs · ${summary.skippedCached} already cached · ` +
      `${summary.skippedNoPhoto} without photos · ${summary.failed} failed.`
  );
  process.exit(summary.analyzed === 0 && summary.candidates > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
