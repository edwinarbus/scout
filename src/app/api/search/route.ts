import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { buildDogViews } from "@/lib/dogView";
import {
  applyParsedQuery,
  gateByFit,
  mergeRerank,
  normalizeParsed,
  parseQuery,
  pinDemoTopPick,
  rerankMatches,
  RERANK_SHORTLIST_SIZE,
  type DogAiTags,
  type ParsedQuery,
  type UserLocation,
} from "@/lib/aiSearch";
import { hasAnthropicCredential, MissingCredentialError } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

interface SearchBody {
  query?: string;
  /** Browser geolocation, when the user shared it. */
  location?: { latitude?: number; longitude?: number } | null;
  /** Echo of /api/search/parse output — skips re-parsing (staged UI). */
  parsed?: unknown;
  /** "filter" = deterministic stages only (fast); "full" (default) = + re-rank. */
  mode?: "filter" | "full";
}

/**
 * Natural-language dog search.
 * POST { query, location?, parsed?, mode? } → { interpretation, results[] … }.
 *
 * Three stages: Claude parses the phrase into structured criteria; the server
 * hard-filters + shortlists deterministically; Claude re-ranks the shortlist
 * using shelter facts + bio + AI photo read + breed-typical knowledge, with
 * every reason labeled by source. The staged UI calls /api/search/parse, then
 * mode:"filter" (results in ~a second), then mode:"full" (deep rank) — while a
 * bare { query } still runs the whole pipeline in one call. The re-rank
 * degrades gracefully — on failure the deterministic ranking is returned.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as SearchBody | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "provide a non-empty query" }, { status: 400 });
  }
  if (!hasAnthropicCredential()) {
    return NextResponse.json(
      {
        error:
          "Natural-language search needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env.local and restart the dev server. You can still use the filters without it.",
      },
      { status: 503 }
    );
  }

  const loc = body?.location;
  const userLocation: UserLocation | null =
    typeof loc?.latitude === "number" &&
    typeof loc?.longitude === "number" &&
    Number.isFinite(loc.latitude) &&
    Number.isFinite(loc.longitude)
      ? { latitude: loc.latitude, longitude: loc.longitude }
      : null;
  const mode = body?.mode === "filter" ? "filter" : "full";

  const db = await getDb();
  try {
    const parsed: ParsedQuery = body?.parsed ? normalizeParsed(body.parsed) : await parseQuery(query);
    const dogs = await buildDogViews(db);
    const aiByDog = new Map<string, DogAiTags>(
      dogs
        .filter((d) => d.ai)
        .map((d) => [
          d.id,
          {
            tags: d.ai!.tags,
            coatTexture: d.ai!.coatTexture,
            coatLength: d.ai!.coatLength,
            apparentSize: d.ai!.apparentSize,
            visualDescription: d.ai!.visualDescription,
          },
        ])
    );
    const deterministic = applyParsedQuery(parsed, dogs, aiByDog, userLocation);
    const rerank =
      mode === "full"
        ? await rerankMatches(query, deterministic.slice(0, RERANK_SHORTLIST_SIZE))
        : null;
    // Once the deep read has scored fit, only surface genuine matches — a dog
    // whose breed/coat/location the model flagged as contradicting the request
    // is dropped, not shown with disqualifying caveats. (Demo pin runs first so
    // its fixed 97 keeps the hero dog above the fit cutoff.)
    const matches = gateByFit(
      pinDemoTopPick(query, mergeRerank(deterministic, rerank)),
      rerank != null
    );
    return NextResponse.json({
      interpretation: parsed.interpretation,
      parsed,
      usedLocation: !!userLocation && !parsed.nearPlace,
      reranked: rerank != null,
      totalDogs: dogs.length,
      shortlistSize: Math.min(deterministic.length, RERANK_SHORTLIST_SIZE),
      total: matches.length,
      results: matches.slice(0, 200).map((m) => ({
        dog: m.dog,
        score: m.score,
        reasons: m.reasons,
        unknowns: m.unknowns,
      })),
    });
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `search failed: ${message}` }, { status: 500 });
  }
}
