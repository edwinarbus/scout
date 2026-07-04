/**
 * Prune placeholder / broken photos from the DB so no "image available soon"
 * card or dead image ever reaches the UI, the map, or an overnight SMS.
 *
 * Three passes:
 *   1. Pattern — any primary photo URL that names itself a placeholder.
 *   2. Resolve — petharbor.com/get_image.asp URLs (LA Animal Services & friends)
 *      redirect missing photos to a fixed no_pic graphic; we follow the redirect
 *      and drop any that land on a placeholder or return an error.
 *   3. Dimensions — every remaining URL is fetched and measured (via sharp);
 *      a match against a known placeholder graphic's exact pixel size (e.g.
 *      24petconnect's 232×246 "No Image Available" card) is pruned too. This
 *      is the same check the browser does reactively on load — running it
 *      here catches it before a dog ever reaches the UI, instead of the photo
 *      flashing in a card first and disappearing once the client notices.
 *
 * Nulling primary_photo_url is enough: buildDogViews drops any dog without one,
 * so pruned dogs disappear everywhere. Idempotent — safe to re-run, and worth
 * wiring into the nightly job before the overnight scout.
 *
 *   npm run scout:prune-photos            # clean the DB
 *   npm run scout:prune-photos -- --dry-run
 */
import { config as loadEnvFile } from "dotenv";
loadEnvFile({ path: ".env.local" });

import { parseArgs } from "node:util";
import sharp from "sharp";
import { inArray, isNotNull } from "drizzle-orm";
import { createDb } from "@/db";
import { dogListings } from "@/db/schema";
import { isPlaceholderDimension, isPlaceholderPhotoUrl } from "@/lib/photo";

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = !!args["dry-run"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * True if the URL is broken or resolves to a placeholder graphic. Reads the
 * redirect Location header (redirect: "manual") instead of downloading the
 * image — lighter on the shelter's host and definitive for petharbor's no_pic
 * redirect. Retries transient failures so rate-limiting doesn't hide placeholders.
 */
async function resolvesToPlaceholder(url: string, attempt = 0): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(9000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") ?? "";
      return isPlaceholderPhotoUrl(loc) || /no[-_]?pic/i.test(loc);
    }
    res.body?.cancel?.();
    if (res.status >= 400) return true; // broken image
    return false; // 200 direct → a real photo
  } catch {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return resolvesToPlaceholder(url, attempt + 1);
    }
    return false; // give up gracefully — don't prune on uncertainty
  }
}

/**
 * True if the URL's actual image resolves to a known placeholder graphic's
 * pixel dimensions. Downloads the image (dimensions live in the header, but
 * shelter thumbnails are small enough that a partial-fetch optimization isn't
 * worth the complexity) and reads its size with sharp — no full decode needed.
 */
async function isPlaceholderImage(url: string, attempt = 0): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return true; // broken image
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return false; // couldn't read — don't prune on uncertainty
    return isPlaceholderDimension(meta.width, meta.height);
  } catch {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return isPlaceholderImage(url, attempt + 1);
    }
    return false;
  }
}

/** Run an async check over items with gentle bounded concurrency (polite to the
 *  shelter host: a few workers, a short pause between each request). */
async function filterConcurrent<T>(
  items: T[],
  test: (t: T) => Promise<boolean>,
  limit = 4,
  delayMs = 200
): Promise<T[]> {
  const hits: T[] = [];
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        if (await test(item)) hits.push(item);
        done += 1;
        if (done % 100 === 0) console.log(`  …${done}/${items.length} checked`);
        await sleep(delayMs);
      }
    })
  );
  return hits;
}

async function main() {
  const db = await createDb();
  const rows = await db
    .select({ url: dogListings.primaryPhotoUrl })
    .from(dogListings)
    .where(isNotNull(dogListings.primaryPhotoUrl))
    .all();
  const urls = [...new Set(rows.map((r) => r.url).filter((u): u is string => !!u))];
  console.log(`${urls.length} distinct primary photo URLs.`);

  // Pass 1 — pattern (no network).
  const byPattern = urls.filter(isPlaceholderPhotoUrl);

  // Pass 2 — resolve petharbor redirect placeholders (network, concurrency-limited).
  const petharbor = urls.filter((u) => /petharbor\.com\/get_image/i.test(u) && !byPattern.includes(u));
  console.log(`Resolving ${petharbor.length} petharbor URLs…`);
  const byResolve = await filterConcurrent(petharbor, resolvesToPlaceholder);

  // Pass 3 — everything else: fetch + measure against known placeholder sizes
  // (24petconnect's "No Image Available" card, petharbor's cartoon card, …).
  const checkedSoFar = new Set([...byPattern, ...petharbor]);
  const remaining = urls.filter((u) => !checkedSoFar.has(u));
  console.log(`Measuring ${remaining.length} remaining URLs…`);
  const byDimension = await filterConcurrent(remaining, isPlaceholderImage);

  const bad = [...new Set([...byPattern, ...byResolve, ...byDimension])];
  console.log(
    `Placeholder/broken: ${byPattern.length} by pattern + ${byResolve.length} resolved + ${byDimension.length} by dimension = ${bad.length} URLs.`
  );

  if (!bad.length) return console.log("Nothing to prune.");
  if (dryRun) {
    console.log("DRY RUN — would null primary_photo_url for the above. Examples:");
    bad.slice(0, 5).forEach((u) => console.log(`  ${u}`));
    return;
  }

  let pruned = 0;
  for (let j = 0; j < bad.length; j += 200) {
    const chunk = bad.slice(j, j + 200);
    const res = await db
      .update(dogListings)
      .set({ primaryPhotoUrl: null })
      .where(inArray(dogListings.primaryPhotoUrl, chunk))
      .run();
    pruned += res.rowsAffected;
  }
  console.log(`Pruned ${pruned} listing(s) — they'll no longer appear anywhere.`);
}

main();
