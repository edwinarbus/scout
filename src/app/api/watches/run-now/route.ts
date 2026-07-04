import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { watches } from "@/db/schema";
import { buildDogViews } from "@/lib/dogView";
import { buildAiIndex, evaluateWatch, selectNewMatches, type WatchLike } from "@/lib/watchEval";
import { hasSms, sendSms } from "@/lib/sms";
import { isPlaceholderName } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/**
 * POST /api/watches/run-now — trigger the overnight scout ON DEMAND for the
 * newest saved watch and text its single best match right now, as if a Managed
 * Agent run had just surfaced it.
 *
 * Unlike the scheduled overnight job this does NOT re-scrape (so it's instant
 * and reliable to fire live) and does NOT consult the already-notified ledger
 * (so it always sends about the current top-fit dog and can be re-run) — it
 * evaluates the watch against the dogs already in the DB, takes the #1 ranked
 * adoptable match, and sends one SMS. The watch's lastChecked/lastNotified
 * bookkeeping is bumped so the UI reflects a fresh pickup.
 */
export async function POST() {
  if (!hasSms()) {
    return NextResponse.json({ ok: false, error: "SMS not configured" }, { status: 400 });
  }

  const db = await getDb();
  const watch = await db
    .select()
    .from(watches)
    .where(eq(watches.active, true))
    .orderBy(desc(watches.createdAt))
    .get();
  if (!watch) {
    return NextResponse.json(
      { ok: false, error: "No saved searches yet — save a search first." },
      { status: 400 }
    );
  }

  const now = new Date();
  const dogs = await buildDogViews(db, now);
  const aiByDog = buildAiIndex(dogs);
  const watchLike: WatchLike = {
    id: watch.id,
    query: watch.query,
    parsed: watch.parsed,
    latitude: watch.latitude,
    longitude: watch.longitude,
  };
  const ranked = evaluateWatch(watchLike, dogs, aiByDog);
  // Top fit: highest-scored adoptable, photographed, present dog. `alreadyNotified`
  // is intentionally empty so the demo always speaks to the current best match.
  const [top] = selectNewMatches(ranked, { alreadyNotified: new Set(), limit: 1 });
  if (!top) {
    return NextResponse.json(
      { ok: false, error: `No adoptable matches for "${watch.label}" right now.` },
      { status: 200 }
    );
  }

  const d = top.dog;
  const dogName = d.name && !isPlaceholderName(d.name) ? d.name : "A new dog";
  const shelterName = d.shelterName ?? d.shelterLocationName ?? d.source.name;
  const body =
    `${dogName}, was just found at ${shelterName}, and matches your ${watch.label} search.` +
    ` ${d.originalUrl}`;

  const sent = (await sendSms(body)) === "ok";

  // Reflect a fresh agent pickup in the watch's bookkeeping so the panel/bell
  // read as if the scout just ran and found something new.
  if (sent) {
    await db
      .update(watches)
      .set({
        lastCheckedAt: now,
        lastNotifiedAt: now,
        notifiedCount: watch.notifiedCount + 1,
      })
      .where(eq(watches.id, watch.id))
      .run();
  }

  return NextResponse.json(
    {
      ok: sent,
      dog: dogName,
      shelter: shelterName,
      search: watch.label,
      ...(sent ? {} : { error: "Couldn't send — check your Twilio keys." }),
    },
    { status: sent ? 200 : 502 }
  );
}
