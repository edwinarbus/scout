import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { adoptionSources } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Toggle a source on/off from the dashboard (crawling stays CLI-driven). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const source = db
    .select()
    .from(adoptionSources)
    .where(eq(adoptionSources.id, id))
    .get();
  if (!source) return NextResponse.json({ error: "unknown source" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "body must be { enabled: boolean }" }, { status: 400 });
  }
  db.update(adoptionSources)
    .set({ enabled: body.enabled, updatedAt: new Date() })
    .where(eq(adoptionSources.id, id))
    .run();
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
