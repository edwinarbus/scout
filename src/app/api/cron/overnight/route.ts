import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { runOvernight } from "@/ingest/overnight";

export const dynamic = "force-dynamic";
// Give this the full Fluid Compute budget — a full ingest across every
// source + the watch/curation pass can run long.
export const maxDuration = 300;

/**
 * POST /api/cron/overnight → run the overnight pipeline (ingest every source,
 * re-check every watch, curate + text new matches) on THIS deployment, where
 * ANTHROPIC_API_KEY / TURSO_* / SCOUT_TWILIO_* already live as Vercel env vars.
 *
 * The trigger is a scheduled Claude Managed Agent deployment (see
 * scripts/setup-overnight-agent.ts) whose only job is to hit this URL on a
 * cron — it never sees the app's real secrets, just CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const summary = await runOvernight(db, { log: (m) => console.log(`[cron:overnight] ${m}`) });
  return NextResponse.json(summary);
}
