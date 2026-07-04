import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { hasPush, vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/push → whether push is configured + the VAPID public key to subscribe. */
export function GET() {
  return NextResponse.json({ enabled: hasPush(), publicKey: vapidPublicKey() });
}

interface SubBody {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
}

/** POST /api/push → store (upsert) a browser push subscription. */
export async function POST(req: Request) {
  if (!hasPush()) {
    return NextResponse.json({ error: "push not configured" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as SubBody | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  const db = getDb();
  const now = new Date();
  db.insert(pushSubscriptions)
    .values({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: req.headers.get("user-agent") ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    })
    .run();
  return NextResponse.json({ ok: true });
}

/** DELETE /api/push { endpoint } → forget a subscription (user turned it off). */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  const db = getDb();
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint)).run();
  return NextResponse.json({ ok: true });
}
