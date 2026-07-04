import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { watches } from "@/db/schema";

export const dynamic = "force-dynamic";

/** PATCH /api/watches/:id { active } → pause/resume a watch. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const watchId = Number(id);
  if (!Number.isInteger(watchId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { active?: boolean } | null;
  if (typeof body?.active !== "boolean") {
    return NextResponse.json({ error: "active (boolean) required" }, { status: 400 });
  }
  const db = getDb();
  db.update(watches).set({ active: body.active }).where(eq(watches.id, watchId)).run();
  return NextResponse.json({ ok: true });
}

/** DELETE /api/watches/:id → remove a watch (its notification ledger cascades). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const watchId = Number(id);
  if (!Number.isInteger(watchId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const db = getDb();
  db.delete(watches).where(eq(watches.id, watchId)).run();
  return NextResponse.json({ ok: true });
}
