import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { watches } from "@/db/schema";
import { normalizeParsed, parseQuery, type ParsedQuery } from "@/lib/aiSearch";
import { hasAnthropicCredential } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

/** GET /api/watches → the owner's standing watches, newest first. */
export function GET() {
  const db = getDb();
  const rows = db.select().from(watches).orderBy(desc(watches.createdAt)).all();
  return NextResponse.json({
    watches: rows.map((w) => ({
      id: w.id,
      label: w.label,
      query: w.query,
      active: w.active,
      createdAt: w.createdAt,
      lastCheckedAt: w.lastCheckedAt,
      lastNotifiedAt: w.lastNotifiedAt,
      notifiedCount: w.notifiedCount,
    })),
  });
}

interface CreateBody {
  query?: string;
  label?: string;
  /** ParsedQuery captured client-side during the search (preferred). */
  parsed?: unknown;
  location?: { latitude?: number; longitude?: number } | null;
}

/**
 * POST /api/watches → save a standing watch from the current search. The client
 * passes the parsed criteria it already has; if absent we parse server-side
 * (needs a key). The overnight scout re-runs these and pushes new matches.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "provide a non-empty query" }, { status: 400 });
  }

  let parsed: ParsedQuery;
  if (body?.parsed) {
    parsed = normalizeParsed(body.parsed);
  } else if (hasAnthropicCredential()) {
    parsed = await parseQuery(query);
  } else {
    return NextResponse.json(
      { error: "no parsed criteria supplied and no API key to parse the query" },
      { status: 400 }
    );
  }

  const loc = body?.location;
  const latitude =
    typeof loc?.latitude === "number" && Number.isFinite(loc.latitude) ? loc.latitude : null;
  const longitude =
    typeof loc?.longitude === "number" && Number.isFinite(loc.longitude) ? loc.longitude : null;

  const label = (body?.label?.trim() || query).slice(0, 80);
  const now = new Date();
  const db = getDb();
  const row = db
    .insert(watches)
    .values({
      label,
      query,
      parsed: parsed as unknown as Record<string, unknown>,
      latitude,
      longitude,
      active: true,
      createdAt: now,
    })
    .returning()
    .get();

  return NextResponse.json({ watch: { id: row.id, label: row.label, query: row.query } });
}
