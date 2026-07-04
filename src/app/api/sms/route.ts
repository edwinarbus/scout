import { NextResponse } from "next/server";
import { hasSms, sendSms, smsRecipientMasked } from "@/lib/sms";

export const dynamic = "force-dynamic";

/** GET /api/sms → whether text alerts are configured, and the masked recipient. */
export function GET() {
  return NextResponse.json({ enabled: hasSms(), to: smsRecipientMasked() });
}

/** POST /api/sms → send a test text to the configured recipient. */
export async function POST() {
  if (!hasSms()) {
    return NextResponse.json({ ok: false, error: "SMS not configured" }, { status: 400 });
  }
  const result = await sendSms(
    "Scout test — text alerts are working. You'll get a message here when a new match appears."
  );
  return NextResponse.json({ ok: result === "ok" }, { status: result === "ok" ? 200 : 502 });
}
