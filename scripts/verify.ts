/**
 * Adapter verification CLI.
 *
 *   npm run verify                       # fixture-mode, all sources with adapters
 *   npm run verify -- --source laas      # one source (fixtures)
 *   npm run verify -- --enabled          # only enabled sources
 *   npm run verify -- --live             # capped live crawls (a few pages, no DB writes)
 *   npm run verify -- --source laas --live
 */
import { parseArgs } from "node:util";
import { createDb } from "@/db";
import { adoptionSources } from "@/db/schema";
import { getAdapter } from "@/adapters";
import { verifyFixtures, verifyLive, type VerifyReport } from "@/ingest/verify";

const { values: args } = parseArgs({
  options: {
    source: { type: "string", multiple: true },
    enabled: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

function fmt(r: VerifyReport, verbose: boolean): string {
  const mark = r.verdict === "pass" ? "PASS" : r.verdict === "partial" ? "PARTIAL" : "FAIL";
  const keyLabel =
    r.dedupeKeyStrength === "animal_id"
      ? "animal ID"
      : r.dedupeKeyStrength === "original_url"
        ? "originalUrl"
        : r.dedupeKeyStrength;
  let out = `- ${r.sourceId}: ${mark.toLowerCase()}, ${r.dogsSampled} dogs sampled (${r.mode}), dedupe key: ${keyLabel}`;
  const problems = r.checks.filter((c) => c.ok === false);
  for (const c of problems) out += `\n    ✗ ${c.name}${c.info ? ` — ${c.info}` : ""}`;
  if (verbose) {
    for (const c of r.checks.filter((c) => c.ok !== false))
      out += `\n    ${c.ok === true ? "✓" : "·"} ${c.name}${c.info ? ` — ${c.info}` : ""}`;
  }
  for (const n of r.notes) out += `\n    note: ${n}`;
  return out;
}

async function main() {
  const db = await createDb();
  let sources = await db.select().from(adoptionSources).all();
  if (args.source?.length) {
    sources = sources.filter((s) => args.source!.includes(s.id));
  } else if (args.enabled) {
    sources = sources.filter((s) => s.enabled);
  } else {
    sources = sources.filter((s) => getAdapter(s.adapterType) != null && s.id !== "mock_bay_area");
  }
  if (sources.length === 0) {
    console.log("No matching sources. Try --source <id> or seed first.");
    process.exit(2);
  }

  console.log(`Verifying ${sources.length} source(s) in ${args.live ? "LIVE" : "fixture"} mode:\n`);
  const reports: VerifyReport[] = [];
  for (const s of sources) {
    const r = args.live
      ? await verifyLive(db, s.id)
      : await verifyFixtures(s.id, s.adapterType);
    reports.push(r);
    console.log(fmt(r, !!args.verbose));
  }

  const pass = reports.filter((r) => r.verdict === "pass").length;
  const partial = reports.filter((r) => r.verdict === "partial").length;
  const fail = reports.filter((r) => r.verdict === "fail").length;
  console.log(`\n${pass} pass, ${partial} partial, ${fail} fail.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
