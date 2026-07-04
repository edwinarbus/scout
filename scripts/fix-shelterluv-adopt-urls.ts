/**
 * ONE-TIME fix: ShelterLuv-sourced dogListings rows ingested before the
 * adopter change in src/adapters/shelterluv.ts stored the embed listing page
 * as originalUrl (the Adopt button's target) instead of the real adopt/apply
 * link. The ingest runner's "unchanged" fast path only touches
 * lastSeenAt/lifecycle fields when a dog's raw feed payload hasn't changed,
 * so already-ingested ShelterLuv dogs would never pick up the corrected URL
 * on their own — this backfills them directly.
 *
 * Safe to re-run: only touches rows whose originalUrl still matches the old
 * `/embed/animal/{nid}` pattern.
 *
 *   npx tsx scripts/fix-shelterluv-adopt-urls.ts
 */
import { getDb } from "@/db";
import { dogListings } from "@/db/schema";
import { eq, like } from "drizzle-orm";

const EMBED_RE = /^(https?:\/\/[^/]+)\/embed\/animal\/(\d+)$/;

async function main() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(dogListings)
    .where(like(dogListings.originalUrl, "%/embed/animal/%"));

  let fixed = 0;
  for (const row of rows) {
    const m = row.originalUrl.match(EMBED_RE);
    if (!m || !row.sourceAnimalId) continue;
    const [, domain, nid] = m;
    const newUrl = `${domain}/matchme/adopt/${encodeURIComponent(row.sourceAnimalId)}?nid=${nid}&_csrfToken=`;
    await db.update(dogListings).set({ originalUrl: newUrl }).where(eq(dogListings.id, row.id)).run();
    fixed++;
    console.log(`  ${row.id}: ${row.originalUrl} → ${newUrl}`);
  }
  console.log(`\nFixed ${fixed} ShelterLuv listing(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
