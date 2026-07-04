import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { hasPush, sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/test → send a friendly test notification to all of this
 * account's subscribed devices, so the owner can confirm push works end-to-end.
 */
export async function POST() {
  if (!hasPush()) {
    return NextResponse.json({ error: "push not configured" }, { status: 503 });
  }
  const db = await getDb();
  const sent = await sendPushToAll(db, {
    title: "Scout is on the case 🐾",
    body: "Notifications are on. I'll ping you when a new match shows up.",
    url: "/",
    tag: "scout-test",
  });
  return NextResponse.json({ ok: true, sent });
}
