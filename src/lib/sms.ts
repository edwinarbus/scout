import { config as loadEnvFile } from "dotenv";

/**
 * SMS alerts for the overnight scout, via the Twilio REST API.
 *
 * Personal, single-user: the owner sets their Twilio credentials + a recipient
 * number, and every new-match alert is texted to them. Fully optional — with no
 * Twilio env vars the app behaves exactly as before (the overnight job just logs
 * matches instead of texting). No SDK needed; Twilio's API is a form POST.
 *
 * Configure in .env.local (never commit these):
 *   SCOUT_TWILIO_ACCOUNT_SID   AC…
 *   SCOUT_TWILIO_AUTH_TOKEN    (secret)
 *   SCOUT_TWILIO_FROM          your Twilio number, e.g. +18777804236
 *   SCOUT_SMS_TO               where alerts go, e.g. +14845572772
 */

// CLI scripts don't get Next's automatic .env.local load; do it here too.
loadEnvFile({ path: ".env.local" });

const ACCOUNT_SID = process.env.SCOUT_TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.SCOUT_TWILIO_AUTH_TOKEN ?? "";
const FROM = process.env.SCOUT_TWILIO_FROM ?? "";
const TO = process.env.SCOUT_SMS_TO ?? "";

/** True when Twilio + a recipient are configured — SMS is available. */
export function hasSms(): boolean {
  return !!(ACCOUNT_SID && AUTH_TOKEN && FROM && TO);
}

/** The configured recipient, masked for display (e.g. "+1 (•••) •••-2772"). */
export function smsRecipientMasked(): string {
  if (!TO) return "";
  const tail = TO.replace(/\D/g, "").slice(-4);
  return `•••-${tail}`;
}

/**
 * Text one message to the configured recipient (or an explicit number). Returns
 * "ok", or "error" on any failure. Safe to call when SMS is unconfigured
 * (returns "error" without throwing). Never logs the auth token.
 */
export async function sendSms(body: string, to: string = TO): Promise<"ok" | "error"> {
  if (!hasSms() || !to) return "error";
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: FROM, Body: body }).toString(),
      }
    );
    if (res.ok) return "ok";
    // Surface the Twilio error message (not the token) to help configuration.
    const detail = await res.text().catch(() => "");
    console.error(`Twilio send failed (${res.status}): ${detail.slice(0, 300)}`);
    return "error";
  } catch (err) {
    console.error("Twilio send error:", (err as Error).message);
    return "error";
  }
}
