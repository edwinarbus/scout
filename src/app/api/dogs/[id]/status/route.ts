import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { dogListings, userDogStatuses } from "@/db/schema";
import { USER_DOG_STATUSES, type UserDogStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Set or clear the local user status for one dog listing. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const dogId = decodeURIComponent(id);
  const db = await getDb();

  const listing = await db.select().from(dogListings).where(eq(dogListings.id, dogId)).get();
  if (!listing) {
    return NextResponse.json({ error: "unknown dog listing" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    status?: UserDogStatus | null;
    notes?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  if (body.status == null) {
    await db.delete(userDogStatuses).where(eq(userDogStatuses.dogListingId, dogId)).run();
    return NextResponse.json({ ok: true, status: null });
  }
  if (!USER_DOG_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of ${USER_DOG_STATUSES.join(", ")} or null` },
      { status: 400 }
    );
  }
  await db
    .insert(userDogStatuses)
    .values({
      dogListingId: dogId,
      status: body.status,
      notes: body.notes ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userDogStatuses.dogListingId,
      set: { status: body.status, notes: body.notes ?? null, updatedAt: new Date() },
    })
    .run();
  return NextResponse.json({ ok: true, status: body.status });
}
