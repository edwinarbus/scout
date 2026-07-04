import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { adoptionSources, sourceRuns } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const sources = await db.select().from(adoptionSources).all();
  const runs = await db.select().from(sourceRuns).orderBy(desc(sourceRuns.startedAt)).all();
  const lastRuns = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastRuns.has(r.sourceId)) lastRuns.set(r.sourceId, r);
  return NextResponse.json({
    sources: sources.map((s) => ({ ...s, lastRun: lastRuns.get(s.id) ?? null })),
  });
}
