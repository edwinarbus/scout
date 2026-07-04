import { createStructured, SEARCH_MODEL, type JsonSchema } from "./anthropic";
import { cityCoords, countyCoords } from "./geo";
import { matchListing, type SearchCriteria } from "./match";
import type { DogView } from "./dogView";

/**
 * Natural-language dog search — a three-stage pipeline:
 *
 *  1. PARSE (Claude, one small call): translate the user's phrase into
 *     structured criteria plus soft visual/keyword preferences. No dog data
 *     is sent — only the query text.
 *  2. FILTER + SHORTLIST (deterministic): matchListing() hard-filters; soft
 *     trait/keyword hits against AI photo reads and bios rank a shortlist.
 *     Fully explainable, works with zero API calls if stage 3 is skipped.
 *  3. RE-RANK (Claude, one call over the shortlist only): compact summaries of
 *     the top candidates — shelter facts, bio excerpt, AI photo read — go to
 *     the model, which scores fit using breed-typical knowledge the data
 *     can't express ("chihuahua mixes usually suit apartments"). Every reason
 *     must be labeled with its source; the stage degrades gracefully back to
 *     the deterministic ranking on any failure.
 */

export interface ParsedQuery {
  breedIncludes: string[];
  breedExcludes: string[];
  sizes: Array<"small" | "medium" | "large" | "xlarge">;
  ageBuckets: Array<"puppy" | "young" | "adult" | "senior">;
  excludePuppies: boolean;
  colors: string[];
  sexes: Array<"male" | "female">;
  /** Weight bounds in lbs ("less than 25lb" → maxWeightLbs 25). */
  minWeightLbs: number | null;
  maxWeightLbs: number | null;
  /** Length-of-stay bounds in days ("waiting more than 2 months" → min 60). */
  minDaysInShelter: number | null;
  maxDaysInShelter: number | null;
  /** City/landmark the user referenced; server geocodes it to a center. */
  nearPlace: string | null;
  maxDistanceMiles: number | null;
  /** Soft visual traits to match against AI photo reads, e.g. ["scruffy","fluffy"]. */
  visualTraits: string[];
  /** Free-text keywords to look for in name/breed/bio, e.g. ["lap dog","hiking"]. */
  keywords: string[];
  /** One-line restatement of what the user is looking for. */
  interpretation: string;
}

/** Browser-provided coordinates (geolocation API) used when no place is named. */
export interface UserLocation {
  latitude: number;
  longitude: number;
}

export const QUERY_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    breedIncludes: { type: "array", items: { type: "string" } },
    breedExcludes: { type: "array", items: { type: "string" } },
    sizes: { type: "array", items: { type: "string", enum: ["small", "medium", "large", "xlarge"] } },
    ageBuckets: {
      type: "array",
      items: { type: "string", enum: ["puppy", "young", "adult", "senior"] },
    },
    excludePuppies: { type: "boolean" },
    colors: { type: "array", items: { type: "string" } },
    sexes: { type: "array", items: { type: "string", enum: ["male", "female"] } },
    minWeightLbs: { type: ["number", "null"] },
    maxWeightLbs: { type: ["number", "null"] },
    minDaysInShelter: { type: ["number", "null"] },
    maxDaysInShelter: { type: ["number", "null"] },
    nearPlace: { type: ["string", "null"] },
    maxDistanceMiles: { type: ["number", "null"] },
    visualTraits: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    interpretation: { type: "string" },
  },
  required: [
    "breedIncludes",
    "breedExcludes",
    "sizes",
    "ageBuckets",
    "excludePuppies",
    "colors",
    "sexes",
    "minWeightLbs",
    "maxWeightLbs",
    "minDaysInShelter",
    "maxDaysInShelter",
    "nearPlace",
    "maxDistanceMiles",
    "visualTraits",
    "keywords",
    "interpretation",
  ],
};

export const SEARCH_SYSTEM_PROMPT = `You translate a person's natural-language description of the dog they want into a structured search filter for a California dog-adoption tool. You do NOT pick dogs — a deterministic matcher does that from your filter.

Guidance:
- Only fill fields the user actually implied; leave arrays empty and scalars null otherwise. Do not invent constraints.
- breedIncludes/breedExcludes: breed words the user named (lowercase, singular-ish, e.g. "dachshund", "pit bull", "poodle"). "doodle" → ["poodle"]. Put negatives ("no pit bulls") in breedExcludes.
- excludePuppies: true if they said no puppies / adult only / older.
- ageBuckets: puppy (<1y), young (1-3y), adult (3-8y), senior (8y+). Map "older"/"senior" → ["senior"], "young" → ["young"].
- sizes: small/medium/large/xlarge as implied ("lap dog" → small; "big" → large,xlarge).
- colors: coat colors named.
- minWeightLbs/maxWeightLbs: explicit weight bounds in pounds ("under 25 lbs" → maxWeightLbs 25). Convert kg if needed.
- minDaysInShelter/maxDaysInShelter: length-of-stay bounds in DAYS ("in the shelter more than 2 months" → minDaysInShelter 60; "long-timers" → minDaysInShelter 120; "new arrivals" → maxDaysInShelter 14).
- nearPlace: a California city or place the user named (e.g. "San Francisco", "LA"), else null. maxDistanceMiles: a radius if they gave one, else null.
- visualTraits: appearance words/phrases a photo could show but shelters rarely label — coat looks ("scruffy", "fluffy", "curly", "smooth-coat"), and distinctive physical features kept as short phrases ("one floppy ear", "white spots", "three-legged", "underbite", "one eye"). These are matched against AI photo descriptions, so keep the user's visual wording.
- keywords: other free-text qualities to look for in the dog's bio, e.g. "good with cats", "hiking", "cuddly", "house-trained", "apartment". For functional asks like "good for small apartments", ALSO translate what you confidently can into hard criteria (e.g. sizes small/medium, a weight cap if implied) — a later stage applies deeper breed-typical reasoning, so don't over-constrain here.
- interpretation: one short sentence restating what they're looking for.`;

/** Ask Claude to parse a natural-language query into structured criteria. */
export async function parseQuery(query: string): Promise<ParsedQuery> {
  return createStructured<ParsedQuery>({
    model: SEARCH_MODEL,
    maxTokens: 700,
    system: SEARCH_SYSTEM_PROMPT,
    content: [{ type: "text", text: query }],
    schema: QUERY_SCHEMA,
  });
}

/** Default search radius (miles) when we have a center but no explicit radius. */
export const DEFAULT_RADIUS_MILES = 100;

/**
 * Build the deterministic SearchCriteria (minus soft traits) from a parsed
 * query. A place named IN the query wins; otherwise the browser's geolocation
 * (when shared) becomes the center, with a 100-mile default radius either way.
 */
export function toSearchCriteria(
  parsed: ParsedQuery,
  userLocation?: UserLocation | null
): SearchCriteria {
  const namedPlace =
    parsed.nearPlace != null
      ? cityCoords(parsed.nearPlace) ?? countyCoords(parsed.nearPlace)
      : null;
  const center = namedPlace ?? userLocation ?? null;
  const criteria: SearchCriteria = {};
  if (parsed.breedIncludes.length) criteria.breedIncludes = parsed.breedIncludes;
  if (parsed.breedExcludes.length) criteria.breedExcludes = parsed.breedExcludes;
  if (parsed.sizes.length) criteria.sizes = parsed.sizes;
  if (parsed.ageBuckets.length) criteria.ageBuckets = parsed.ageBuckets;
  if (parsed.excludePuppies) criteria.excludePuppies = true;
  if (parsed.colors.length) criteria.colors = parsed.colors;
  if (parsed.sexes.length) criteria.sexes = parsed.sexes;
  if (parsed.minWeightLbs != null) criteria.weightLbsMin = parsed.minWeightLbs;
  if (parsed.maxWeightLbs != null) criteria.weightLbsMax = parsed.maxWeightLbs;
  if (parsed.minDaysInShelter != null) criteria.daysInShelterMin = parsed.minDaysInShelter;
  if (parsed.maxDaysInShelter != null) criteria.daysInShelterMax = parsed.maxDaysInShelter;
  if (center) {
    criteria.center = { latitude: center.latitude, longitude: center.longitude };
    criteria.maxDistanceMiles = parsed.maxDistanceMiles ?? DEFAULT_RADIUS_MILES;
  }
  return criteria;
}

/**
 * Coerce an untrusted/echoed parsed-query payload back into a well-formed
 * ParsedQuery (the staged UI round-trips it through the client between the
 * parse and rank calls). Anything malformed becomes the harmless default.
 */
export function normalizeParsed(p: unknown): ParsedQuery {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const oneOf = <T extends string>(allowed: readonly T[], v: unknown): T[] =>
    strs(v).filter((x): x is T => (allowed as readonly string[]).includes(x));
  return {
    breedIncludes: strs(o.breedIncludes),
    breedExcludes: strs(o.breedExcludes),
    sizes: oneOf(["small", "medium", "large", "xlarge"] as const, o.sizes),
    ageBuckets: oneOf(["puppy", "young", "adult", "senior"] as const, o.ageBuckets),
    excludePuppies: o.excludePuppies === true,
    colors: strs(o.colors),
    sexes: oneOf(["male", "female"] as const, o.sexes),
    minWeightLbs: num(o.minWeightLbs),
    maxWeightLbs: num(o.maxWeightLbs),
    minDaysInShelter: num(o.minDaysInShelter),
    maxDaysInShelter: num(o.maxDaysInShelter),
    nearPlace: typeof o.nearPlace === "string" ? o.nearPlace : null,
    maxDistanceMiles: num(o.maxDistanceMiles),
    visualTraits: strs(o.visualTraits),
    keywords: strs(o.keywords),
    interpretation: typeof o.interpretation === "string" ? o.interpretation : "",
  };
}

/** A display chip for one understood criterion — powers the live analysis UI. */
export interface CriteriaChip {
  icon: string;
  label: string;
  /** hard = filters dogs out; soft = ranks; place = geography. */
  kind: "hard" | "soft" | "place";
}

const fmtStayBound = (days: number): string =>
  days >= 30 && days % 30 === 0 ? `${days / 30} month${days === 30 ? "" : "s"}` : `${days} days`;

/** Turn a parsed query into human-readable chips (pure; drives the UI). */
export function chipsFromParsed(parsed: ParsedQuery): CriteriaChip[] {
  const chips: CriteriaChip[] = [];
  for (const b of parsed.breedIncludes) chips.push({ icon: "🐾", label: b, kind: "hard" });
  for (const b of parsed.breedExcludes) chips.push({ icon: "🚫", label: `no ${b}`, kind: "hard" });
  for (const s of parsed.sizes) chips.push({ icon: "📏", label: s, kind: "hard" });
  for (const a of parsed.ageBuckets) chips.push({ icon: "🎂", label: a, kind: "hard" });
  if (parsed.excludePuppies) chips.push({ icon: "🚫", label: "no puppies", kind: "hard" });
  for (const c of parsed.colors) chips.push({ icon: "🎨", label: c, kind: "hard" });
  for (const s of parsed.sexes) chips.push({ icon: s === "female" ? "♀" : "♂", label: s, kind: "hard" });
  if (parsed.minWeightLbs != null && parsed.maxWeightLbs != null)
    chips.push({ icon: "⚖️", label: `${parsed.minWeightLbs}–${parsed.maxWeightLbs} lbs`, kind: "hard" });
  else if (parsed.maxWeightLbs != null)
    chips.push({ icon: "⚖️", label: `under ${parsed.maxWeightLbs} lbs`, kind: "hard" });
  else if (parsed.minWeightLbs != null)
    chips.push({ icon: "⚖️", label: `over ${parsed.minWeightLbs} lbs`, kind: "hard" });
  if (parsed.minDaysInShelter != null)
    chips.push({ icon: "⏳", label: `waiting ${fmtStayBound(parsed.minDaysInShelter)}+`, kind: "hard" });
  if (parsed.maxDaysInShelter != null)
    chips.push({ icon: "🆕", label: `arrived within ${fmtStayBound(parsed.maxDaysInShelter)}`, kind: "hard" });
  if (parsed.nearPlace)
    chips.push({
      icon: "📍",
      label: `near ${parsed.nearPlace} · ${parsed.maxDistanceMiles ?? DEFAULT_RADIUS_MILES} mi`,
      kind: "place",
    });
  for (const t of parsed.visualTraits) chips.push({ icon: "👁", label: t, kind: "soft" });
  for (const k of parsed.keywords) chips.push({ icon: "💬", label: k, kind: "soft" });
  return chips;
}

/** AI photo read attached to a dog view for soft matching. */
export interface DogAiTags {
  tags: string[];
  coatTexture: string | null;
  coatLength: string | null;
  apparentSize: string | null;
  visualDescription: string | null;
}

export interface SearchMatch {
  dog: DogView;
  score: number;
  reasons: string[];
  unknowns: string[];
}

/**
 * Apply a parsed query to the dog set deterministically.
 * Hard criteria filter (via matchListing); soft traits/keywords rank + explain.
 */
export function applyParsedQuery(
  parsed: ParsedQuery,
  dogs: DogView[],
  aiByDog: Map<string, DogAiTags>,
  userLocation?: UserLocation | null
): SearchMatch[] {
  const criteria = toSearchCriteria(parsed, userLocation);
  const traits = parsed.visualTraits.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const keywords = parsed.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);

  const results: SearchMatch[] = [];
  for (const dog of dogs) {
    const m = matchListing(
      {
        breedNormalized: dog.breedNormalized,
        breedRaw: dog.breedRaw,
        ageMonthsEstimate: dog.ageMonthsEstimate,
        ageRaw: dog.ageRaw,
        sizeNormalized: dog.sizeNormalized,
        weightLbsEstimate: dog.weightLbsEstimate,
        colorsNormalized: dog.colorsNormalized,
        statusNormalized: dog.statusNormalized,
        sex: dog.sex,
        latitude: dog.latitude,
        longitude: dog.longitude,
        daysInShelter: dog.daysInShelter,
      },
      criteria
    );
    if (!m.matched) continue; // hard criteria must pass

    const reasons = [...m.reasons];
    let score = m.reasons.length;

    // Soft visual traits — matched against the AI photo read (labeled as such).
    const ai = aiByDog.get(dog.id);
    if (traits.length) {
      const haystack = [
        ...(ai?.tags ?? []),
        ai?.coatTexture,
        ai?.coatLength,
        ai?.apparentSize,
        ai?.visualDescription,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      for (const t of traits) {
        if (haystack.includes(t)) {
          score += 2;
          reasons.push(`photo looks "${t}" (AI read)`);
        }
      }
    }

    // Free-text keywords — matched against the shelter bio + breed + name.
    if (keywords.length) {
      const text = [dog.name, dog.breedNormalized, dog.breedRaw, dog.biographyRaw, dog.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      for (const k of keywords) {
        if (text.includes(k)) {
          score += 1;
          reasons.push(`bio mentions "${k}"`);
        }
      }
    }

    // Prefer fresh, available dogs when scores tie.
    if (dog.freshness === "fresh") score += 0.5;
    if (dog.statusNormalized === "available") score += 0.5;

    results.push({ dog, score, reasons, unknowns: m.unknowns });
  }

  results.sort((a, b) => b.score - a.score || a.dog.name?.localeCompare(b.dog.name ?? "") || 0);
  return results;
}

// ---------------------------------------------------------------------------
// Stage 3: Claude re-rank over the deterministic shortlist.
// ---------------------------------------------------------------------------

/** How many top deterministic matches are sent to Claude for re-ranking.
 * Sized so the response (score + ≤3 reasons + caveats per dog) stays well
 * under the output-token cap — a truncated stream is unparseable JSON. */
export const RERANK_SHORTLIST_SIZE = 40;

export interface RerankEntry {
  id: string;
  /** 0–100 fit score for the adopter's request. */
  score: number;
  /** Short reasons, each labeled with its evidence source. */
  reasons: string[];
  /** What's unknown/unverified that matters for this request. */
  caveats: string[];
}

export interface RerankResult {
  results: RerankEntry[];
}

export const RERANK_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          score: { type: "number" },
          reasons: { type: "array", items: { type: "string" } },
          caveats: { type: "array", items: { type: "string" } },
        },
        required: ["id", "score", "reasons", "caveats"],
      },
    },
  },
  required: ["results"],
};

export const RERANK_SYSTEM_PROMPT = `You rank real shelter dogs by how well they fit an adopter's request.

You get the adopter's request, then one line per candidate dog containing:
- shelter-reported facts (breed label, age, sex, size, weight, days in shelter, colors, city)
- an excerpt of the shelter's own bio text, when there is one
- an AI photo read (a single-photo visual impression: tags + one-line description), when there is one

Score each dog 0-100 for fit, combining FOUR kinds of evidence, and label every reason with its source:
1. shelter facts — cite plainly: "22 lbs, under the 25 lb limit"
2. shelter bio — "bio: 'does great in apartments'"
3. photo read — "photo read: one ear up, one floppy" (an impression from one photo, not a verified fact)
4. breed-typical knowledge — what the breed label typically implies about temperament, energy, size, and suitability: "breed-typical: chihuahua mixes usually suit small apartments". Always phrase as typical of the breed, never as this dog's verified trait.

Rules:
- NEVER invent a fact about a specific dog. If nothing in the data addresses part of the request (e.g. they asked for three-legged and no source mentions legs), do not claim it — record it in caveats as "no data on ...".
- A dog whose data contradicts a hard part of the request scores low.
- reasons: up to 3 labeled phrases, each 12 words or fewer. caveats: only what actually matters for THIS request, also brief.
- Use the full scoring range honestly; don't cluster everything around 70.
- Score EVERY candidate you were given, using their exact id.`;

const excerpt = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

/** One compact, human-readable evidence line per candidate (pure; testable). */
export function candidateBlock(m: SearchMatch): string {
  const d = m.dog;
  const facts = [
    `id=${d.id}`,
    `name=${d.name ?? "?"}`,
    `breed=${d.breedRaw ?? d.breedNormalized ?? "unknown"}`,
    `age=${d.ageRaw ?? (d.ageMonthsEstimate != null ? `${d.ageMonthsEstimate}mo` : "unknown")}`,
    `sex=${d.sex ?? "unknown"}`,
    `size=${d.sizeNormalized ?? "unknown"}`,
    `weight=${d.weightLbsEstimate != null ? `${d.weightLbsEstimate}lbs` : "unknown"}`,
    `daysInShelter=${d.daysInShelter ?? "unknown"}`,
    `colors=${d.colorsNormalized.length ? d.colorsNormalized.join("/") : "unknown"}`,
    d.city ? `city=${d.city}` : null,
  ].filter(Boolean);
  const bio = excerpt(d.biographyRaw ?? d.description, 240);
  const photo = d.ai
    ? excerpt(
        [
          ...(d.ai.tags ?? []),
          d.ai.coatLength && `${d.ai.coatLength} coat`,
          d.ai.coatTexture,
          d.ai.visualDescription,
        ]
          .filter(Boolean)
          .join("; "),
        220
      )
    : null;
  return [
    facts.join(" | "),
    bio ? `  bio: "${bio}"` : `  bio: none`,
    photo ? `  photo read: "${photo}"` : `  photo read: none`,
  ].join("\n");
}

/**
 * Dogs per re-rank call. Output tokens are generated serially within one
 * call, so one 40-dog call ≈ 90s of generation — but eight 5-dog calls run
 * CONCURRENTLY finish in roughly the time of one small call (~10-15s).
 * Same total tokens, same per-reason quality, ~6x less wall-clock.
 */
export const RERANK_CHUNK_SIZE = 5;

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function rerankChunk(query: string, chunk: SearchMatch[]): Promise<RerankEntry[]> {
  const blocks = chunk.map(candidateBlock).join("\n\n");
  const rr = await createStructured<RerankResult>({
    model: SEARCH_MODEL,
    maxTokens: 2000,
    system: RERANK_SYSTEM_PROMPT,
    content: [
      {
        type: "text",
        text: `Adopter's request: "${query}"\n\nCandidate dogs (${chunk.length}):\n\n${blocks}`,
      },
    ],
    schema: RERANK_SCHEMA,
  });
  return rr?.results ?? [];
}

/**
 * Ask Claude to re-rank the shortlist — split into small chunks scored in
 * parallel. A failed chunk only degrades ITS dogs to deterministic order;
 * null (full fallback) only when every chunk fails.
 */
export async function rerankMatches(
  query: string,
  shortlist: SearchMatch[]
): Promise<RerankResult | null> {
  if (!shortlist.length) return null;
  const settled = await Promise.allSettled(
    chunkArray(shortlist, RERANK_CHUNK_SIZE).map((c) => rerankChunk(query, c))
  );
  const results = settled
    .filter((s): s is PromiseFulfilledResult<RerankEntry[]> => s.status === "fulfilled")
    .flatMap((s) => s.value);
  return results.length ? { results } : null;
}

/**
 * Fold Claude's scores back into the full deterministic result list (pure).
 * Re-scored dogs sort first by Claude's 0-100 fit; everything Claude didn't
 * score keeps its deterministic relative order after them. A null rerank
 * (stage failed/skipped) returns the input untouched.
 */
export function mergeRerank(all: SearchMatch[], rerank: RerankResult | null): SearchMatch[] {
  if (!rerank) return all;
  const byId = new Map(rerank.results.map((e) => [e.id, e]));
  const rescored: SearchMatch[] = [];
  const rest: SearchMatch[] = [];
  for (const m of all) {
    const e = byId.get(m.dog.id);
    if (e) {
      rescored.push({
        ...m,
        score: Math.max(0, Math.min(100, e.score)),
        reasons: e.reasons.length ? e.reasons : m.reasons,
        unknowns: [...m.unknowns, ...e.caveats],
      });
    } else {
      rest.push(m);
    }
  }
  rescored.sort((a, b) => b.score - a.score);
  return [...rescored, ...rest];
}

/**
 * Below this Claude fit score, a dog is NOT a real match — the model has
 * scored it low precisely because its breed/coat/location contradict the
 * request. Showing it (with disqualifying caveats like "breed is Pit Bull, not
 * a scruffy terrier · located in Sacramento, far from Oakland") reads as a bad
 * match, so we drop it instead.
 */
export const MIN_FIT_SCORE = 55;

/**
 * Keep only genuine fits once Claude has scored them on the 0–100 scale. A
 * no-op when the re-rank didn't run (the fast filter pass carries deterministic
 * scores that aren't on the 0–100 scale, so thresholding them would wrongly
 * empty the list) — the deep pass then applies the gate. Also drops the
 * un-reranked tail: past the shortlist those dogs are unscored and, for a
 * precise request, low-confidence — better withheld than shown as "matches".
 */
export function gateByFit(matches: SearchMatch[], reranked: boolean): SearchMatch[] {
  return reranked ? matches.filter((m) => m.score >= MIN_FIT_SCORE) : matches;
}
