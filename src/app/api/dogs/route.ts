import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { buildDogViews } from "@/lib/dogView";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const dogs = await buildDogViews(db);
  return NextResponse.json({ dogs, generatedAt: new Date().toISOString() });
}
