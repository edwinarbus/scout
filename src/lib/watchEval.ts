import {
  applyParsedQuery,
  normalizeParsed,
  type DogAiTags,
  type SearchMatch,
  type UserLocation,
} from "@/lib/aiSearch";
import type { DogView } from "@/lib/dogView";

/**
 * Deterministic watch evaluation — the reliable core of the overnight scout.
 * Given a watch's captured criteria and the current dog set, it produces ranked
 * matches and picks the genuinely NEW, adoptable ones (never re-alerting a dog
 * already notified). Pure over its inputs, so it's unit-tested without a DB, a
 * network, or the AI layer. Managed-Agent curation layers on top (optional).
 */

export interface WatchLike {
  id: number;
  query: string;
  /** ParsedQuery JSON captured at watch creation (untrusted → normalized). */
  parsed: unknown;
  latitude: number | null;
  longitude: number | null;
}

/** Build the AI-photo-read index the soft matcher needs, from dog views. */
export function buildAiIndex(dogs: DogView[]): Map<string, DogAiTags> {
  return new Map(
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
}

/** Run one watch's criteria against the dog set (deterministic, ranked). */
export function evaluateWatch(
  watch: WatchLike,
  dogs: DogView[],
  aiByDog: Map<string, DogAiTags>
): SearchMatch[] {
  const parsed = normalizeParsed(watch.parsed);
  const loc: UserLocation | null =
    watch.latitude != null && watch.longitude != null
      ? { latitude: watch.latitude, longitude: watch.longitude }
      : null;
  return applyParsedQuery(parsed, dogs, aiByDog, loc);
}

export interface NewMatchOptions {
  /** Skip dogs already alerted for this watch. */
  alreadyNotified: Set<string>;
  /** Only surface currently-adoptable dogs (default true). */
  availableOnly?: boolean;
  /** Require a photo so the alert looks like something (default true). */
  requirePhoto?: boolean;
  /** Minimum deterministic score to bother alerting (default 0 — any match). */
  minScore?: number;
  /** Cap per run so a big backfill can't fire a hundred notifications (default 12). */
  limit?: number;
}

/**
 * From a watch's ranked matches, select the genuinely NEW ones worth alerting:
 * not previously notified, adoptable, photographed, above a floor score — capped
 * so a first run or a big intake never floods the owner.
 */
export function selectNewMatches(matches: SearchMatch[], opts: NewMatchOptions): SearchMatch[] {
  const {
    alreadyNotified,
    availableOnly = true,
    requirePhoto = true,
    minScore = 0,
    limit = 12,
  } = opts;
  const picked: SearchMatch[] = [];
  for (const m of matches) {
    if (picked.length >= limit) break;
    const d = m.dog;
    if (alreadyNotified.has(d.id)) continue;
    if (m.score < minScore) continue;
    if (requirePhoto && !d.primaryPhotoUrl) continue;
    if (availableOnly && d.statusNormalized !== "available") continue;
    if (d.freshness === "missing") continue; // gone from recent checks
    picked.push(m);
  }
  return picked;
}
