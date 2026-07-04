import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { buildDogViews } from "@/lib/dogView";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const dogs = buildDogViews(db);
  return NextResponse.json({ dogs, generatedAt: new Date().toISOString() });
}
