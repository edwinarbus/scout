import webpush from "web-push";
import { config as loadEnvFile } from "dotenv";
import { eq } from "drizzle-orm";
import type { ScoutDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Web Push (PWA notifications) for Scout's overnight scout + standing watches.
 *
 * Personal, single-user: the owner enables notifications on their own devices;
 * each browser's push subscription is stored and every alert fans out to all of
 * them. Fully optional — with no VAPID keys configured the app behaves exactly
 * as before (subscribe UI hides itself, the overnight job just logs matches).
 *
 * Generate keys once with `npm run scout:vapid` and paste them into .env.local:
 *   SCOUT_VAPID_PUBLIC_KEY, SCOUT_VAPID_PRIVATE_KEY, SCOUT_VAPID_SUBJECT
 */

// CLI scripts don't get Next's automatic .env.local load; do it here too.
loadEnvFile({ path: ".env.local" });

const PUBLIC_KEY = process.env.SCOUT_VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.SCOUT_VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.SCOUT_VAPID_SUBJECT ?? "mailto:scout@localhost";

let configured = false;

/** True when VAPID keys are present — push is available. */
export function hasPush(): boolean {
  return !!(PUBLIC_KEY && PRIVATE_KEY);
}

/** The VAPID public key the browser needs to subscribe (safe to expose). */
export function vapidPublicKey(): string {
  return PUBLIC_KEY;
}

function ensureConfigured() {
  if (configured) return;
  if (!hasPush()) throw new Error("Web Push is not configured (missing VAPID keys)");
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
}

/** The notification payload the service worker renders. */
export interface PushPayload {
  title: string;
  body: string;
  /** Deep link opened on click (e.g. the dog's original listing, or the app). */
  url?: string;
  /** Collapse key so a burst of alerts for one watch stacks instead of spamming. */
  tag?: string;
  icon?: string;
  image?: string;
  /** Arbitrary data echoed to the SW (unused today, room to grow). */
  data?: Record<string, unknown>;
}

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function toWebPush(sub: StoredSubscription): webpush.PushSubscription {
  return { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
}

/**
 * Send one notification to one subscription. Returns "ok", or "gone" when the
 * push service says the subscription is dead (404/410) so the caller can prune
 * it, or "error" for transient failures.
 */
export async function sendPush(
  sub: StoredSubscription,
  payload: PushPayload
): Promise<"ok" | "gone" | "error"> {
  ensureConfigured();
  try {
    await webpush.sendNotification(toWebPush(sub), JSON.stringify(payload), {
      TTL: 24 * 60 * 60, // hold up to a day if the device is offline
      urgency: "normal",
    });
    return "ok";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    return "error";
  }
}

/**
 * Fan a notification out to every stored subscription, pruning any the push
 * service reports as gone. Returns how many devices were reached. Safe to call
 * when push is unconfigured (returns 0 without throwing).
 */
export async function sendPushToAll(db: ScoutDb, payload: PushPayload): Promise<number> {
  if (!hasPush()) return 0;
  const subs = await db.select().from(pushSubscriptions).all();
  if (!subs.length) return 0;

  const now = new Date();
  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      const result = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
      if (result === "ok") {
        delivered += 1;
        await db
          .update(pushSubscriptions)
          .set({ lastNotifiedAt: now })
          .where(eq(pushSubscriptions.endpoint, s.endpoint))
          .run();
      } else if (result === "gone") {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint)).run();
      }
    })
  );
  return delivered;
}
