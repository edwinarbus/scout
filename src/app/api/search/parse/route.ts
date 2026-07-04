import { NextResponse } from "next/server";
import { chipsFromParsed, parseQuery } from "@/lib/aiSearch";
import { hasAnthropicCredential, MissingCredentialError } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

/**
 * Stage 1 of the staged matcher: parse only.
 * POST { query } → { parsed, chips } in a few seconds, so the UI can show
 * what was understood (as criteria chips) while the heavier stages run.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "provide a non-empty query" }, { status: 400 });
  }
  if (!hasAnthropicCredential()) {
    return NextResponse.json(
      { error: "Natural-language search needs an Anthropic API key (set ANTHROPIC_API_KEY in .env.local)." },
      { status: 503 }
    );
  }
  try {
    const parsed = await parseQuery(query);
    return NextResponse.json({ parsed, chips: chipsFromParsed(parsed) });
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `parse failed: ${message}` }, { status: 500 });
  }
}
