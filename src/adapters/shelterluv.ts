import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog } from "@/lib/types";
import { squish, isPlaceholderPhotoUrl, htmlToProseText } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";
import { toIsoDate } from "@/lib/normalize";

/**
 * ShelterLuv (embed-widget backed) adapter. Verified against Rocket Dog Rescue.
 *
 * The public embed (shelterluv_embed.js → iframe /embed/{gid}) is a Vue app
 * whose only data call is:
 *   GET {domain}/api/v3/available-animals/{shelterId}{?saved_query=...}
 *   → { animals: [...], show: {...} }
 * One call returns EVERY available animal for the shelter (all species — the
 * adapter filters to dogs); there is no pagination. Records carry a stable
 * `uniqueId` (e.g. "RCKT-A-6052"), an exact `birthday` timestamp, breed,
 * colors, weight group, a photo set, and a `public_url` detail link.
 *
 * The bio is NOT in that feed at all — it only exists on the per-animal
 * `public_url` page (`/embed/animal/{nid}`), server-rendered as an
 * HTML-attribute-encoded JSON blob (`<iframe-animal :animal="...">`) whose
 * `kennel_description` field is the org's free-text write-up. A bounded
 * detail-page pass (like Oakland's) fetches that page per dog and pulls it out.
 *
 * One adapter serves any ShelterLuv org; per-source config (shelterId + the
 * optional saved_query the shelter's embed uses) lives in SHELTERLUV_TENANTS.
 */

export const SHELTERLUV_PARSER_VERSION = "shelterluv-1.0.0";

const DEFAULT_DOMAIN = "https://new.shelterluv.com";

/** Per-source ShelterLuv config, keyed by source id. */
export const SHELTERLUV_TENANTS: Record<
  string,
  { shelterId: number; savedQuery?: number; domain?: string }
> = {
  rocket_dog_rescue: { shelterId: 184, savedQuery: 7104 },
};

interface SlPhoto {
  url?: string;
  isCover?: boolean;
  order_column?: number;
}

export interface ShelterluvAnimal {
  nid: number;
  name: string | null;
  uniqueId: string | null;
  sex: string | null;
  location: string | null;
  birthday: string | null; // unix seconds (string)
  age_group?: { name?: string | null } | null;
  species: string | null;
  breed: string | null;
  secondary_breed: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  weight_group: string | null; // e.g. "Medium (20-59)"
  attributes?: string[] | null;
  photos?: Record<string, SlPhoto> | null;
  intake_date?: string | null; // unix seconds (string)
  campus?: string | null;
  public_url?: string | null;
  adoptable?: number | null;
}

function tsToIso(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // ShelterLuv timestamps are in seconds.
  return toIsoDate(new Date(n * 1000));
}

/** Photo set is a sparse object keyed by index; cover first, then order_column. */
export function orderedPhotoUrls(photos: Record<string, SlPhoto> | null | undefined): string[] {
  if (!photos) return [];
  return Object.values(photos)
    .filter((p): p is SlPhoto => !!p?.url)
    .sort((a, b) => Number(b.isCover ?? 0) - Number(a.isCover ?? 0) || (a.order_column ?? 0) - (b.order_column ?? 0))
    .map((p) => p.url as string)
    .filter((u, i, arr) => arr.indexOf(u) === i && !isPlaceholderPhotoUrl(u));
}

/** ShelterLuv appends a size band to breed names ("Mixed Breed (Medium)"). */
function cleanBreedName(b: string | null | undefined): string | null {
  return squish(b?.replace(/\s*\((?:x-?small|small|medium|large|x-?large|giant|toy)\)/i, ""));
}

/** The server-rendered per-animal page — has no adopt/apply action of its own,
 *  but is where `kennel_description` (the bio) lives, so the detail-page pass
 *  still needs it even though the UI's Adopt button no longer points here. */
function embedUrl(a: ShelterluvAnimal, domain: string): string {
  return a.public_url ?? `${domain}/embed/animal/${a.nid}`;
}

/** ShelterLuv's actual adoption-application flow — distinct from the embed
 *  page above, which just redisplays the listing. Keyed by the friendly
 *  `uniqueId` (e.g. "RCKT-A-7798"), with the numeric `nid` as a query param;
 *  `_csrfToken` is left blank, matching the real link ShelterLuv serves. */
function adoptUrl(a: ShelterluvAnimal, domain: string): string {
  const uniqueId = squish(a.uniqueId);
  if (!uniqueId) return embedUrl(a, domain); // no friendly id to build the real link — fall back
  return `${domain}/matchme/adopt/${encodeURIComponent(uniqueId)}?nid=${a.nid}&_csrfToken=`;
}

/** Un-escape ONE layer of HTML-attribute encoding — recovers the raw JSON text
 *  the server wrapped in `:animal="…"`. Order matters: decode &amp; LAST, so a
 *  double-escaped entity already inside the bio text (e.g. the literal
 *  substring "&amp;#039;", meaning the bio itself contains a raw "&#039;")
 *  correctly lands as "&#039;" for a second, bio-specific decode later, rather
 *  than being fully resolved here. */
function decodeAttrEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The per-animal embed page (`/embed/animal/{nid}`) is server-rendered with
 * the full animal record — including `kennel_description`, absent from the
 * list feed — embedded as an HTML-attribute-encoded JSON blob on the
 * `<iframe-animal :animal="…">` element. `kennel_description` is itself rich
 * text (raw `<br>` tags + entities, meant for `innerHTML`) — and this org's
 * copy also carries a literal newline riding alongside each `<br>` (an
 * authoring artifact), so it goes through `htmlToProseText` rather than the
 * plain `htmlToText` to avoid landing a paragraph break mid-sentence.
 */
export function parseAnimalDetailPage(html: string): { kennelDescription: string | null } {
  const m = html.match(/<iframe-animal\b[^>]*?\s:animal="([^"]*)"/);
  if (!m) return { kennelDescription: null };
  let animal: unknown;
  try {
    animal = JSON.parse(decodeAttrEntities(m[1]));
  } catch {
    return { kennelDescription: null };
  }
  const raw = (animal as { kennel_description?: unknown } | null)?.kennel_description;
  return { kennelDescription: typeof raw === "string" ? htmlToProseText(raw) : null };
}

export function mapShelterluvAnimal(a: ShelterluvAnimal, domain: string): ExtractedDog {
  const breeds = [a.breed, a.secondary_breed].map(cleanBreedName).filter(Boolean).join(" / ");
  const colors = [a.primary_color, a.secondary_color].map((c) => squish(c)).filter(Boolean).join(" / ");
  const dob = tsToIso(a.birthday);
  // Prefer a DOB-derived age (stable string, accurate estimate); fall back to
  // the shelter's age-group label. Never fabricate when both are absent.
  const ageRaw = dob ? `DOB ${dob}` : squish(a.age_group?.name);
  const inFoster = /foster/i.test(a.location ?? "");
  const photoUrls = orderedPhotoUrls(a.photos);

  return {
    sourceAnimalId: squish(a.uniqueId) ?? String(a.nid),
    originalUrl: adoptUrl(a, domain),
    name: squish(a.name),
    species: squish(a.species) ?? "Dog",
    breedRaw: breeds || null,
    ageRaw,
    sexRaw: squish(a.sex),
    sizeRaw: squish(a.weight_group), // "Medium (20-59)" → normalizes to a size
    weightRaw: null, // no exact weight, only a band
    colorRaw: colors || null,
    statusRaw: a.adoptable ? "Available" : "Not currently adoptable",
    intakeDateRaw: tsToIso(a.intake_date),
    shelterLocationName: squish(a.campus),
    primaryPhotoUrl: photoUrls[0] ?? null,
    photoUrls,
    fosterNotes: inFoster ? "Listed as in a foster home — meet via the rescue." : null,
    rawPayload: { api: a as unknown as Record<string, unknown> },
    cardFingerprint: hashObject(a),
    detailFetched: false, // bio (if any) is attached by a separate detail-page pass below
  };
}

export const shelterluvAdapter: SourceAdapter = {
  system: "shelterluv",
  parserVersion: SHELTERLUV_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const tenant = SHELTERLUV_TENANTS[source.id];
    if (!tenant) {
      throw new Error(
        `no ShelterLuv tenant config for source "${source.id}" — add shelterId to SHELTERLUV_TENANTS`
      );
    }
    const domain = tenant.domain ?? DEFAULT_DOMAIN;
    const warnings: string[] = [];
    const url =
      `${domain}/api/v3/available-animals/${tenant.shelterId}` +
      (tenant.savedQuery != null ? `?saved_query=${tenant.savedQuery}` : "");

    const res = await ctx.fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`ShelterLuv feed returned HTTP ${res.status}`);
    const htmlHash = sha256(res.text);
    let payload: { animals?: ShelterluvAnimal[] };
    try {
      payload = JSON.parse(res.text);
    } catch {
      throw new Error("ShelterLuv feed returned non-JSON");
    }
    const all = payload.animals ?? [];
    ctx.saveDebug("available-animals-meta.json", JSON.stringify({ total: all.length }));
    if (all.length === 0) warnings.push("feed returned zero animals — API may have changed");

    const seen = new Set<string>();
    const dogs: ExtractedDog[] = [];
    // originalUrl is now the adopt/apply link (see adoptUrl) — the detail-page
    // pass below needs the DIFFERENT embed page the bio actually lives on, so
    // that's tracked separately here, keyed by the same sourceAnimalId.
    const embedUrlByAnimalId = new Map<string, string>();
    let nonDog = 0;
    for (const a of all) {
      if (!a || a.nid == null) continue;
      if ((a.species ?? "").toLowerCase() !== "dog") {
        nonDog++;
        continue;
      }
      const key = squish(a.uniqueId) ?? String(a.nid);
      if (seen.has(key)) {
        warnings.push(`duplicate uniqueId in feed: ${key}`);
        continue;
      }
      seen.add(key);
      dogs.push(mapShelterluvAnimal(a, domain));
      embedUrlByAnimalId.set(key, embedUrl(a, domain));
    }
    ctx.log(`feed: ${all.length} animals total, ${dogs.length} dogs (${nonDog} non-dog filtered)`);

    // The feed has no bio field — fetch each dog's public embed page (bounded,
    // and skipped for cards we already have detail for and haven't changed).
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let budgetExhausted = false;
    for (const dog of dogs) {
      // Both are always set by mapShelterluvAnimal — guard keeps the type honest.
      if (!dog.sourceAnimalId || !dog.cardFingerprint) continue;
      if (!ctx.shouldFetchDetail(dog.sourceAnimalId, dog.cardFingerprint)) continue;
      if (detailPagesVisited >= ctx.limits.maxDetailPages) {
        if (!budgetExhausted) {
          warnings.push(
            `detail page budget (${ctx.limits.maxDetailPages}) exhausted; remaining dogs saved without a bio`
          );
          budgetExhausted = true;
        }
        continue;
      }
      try {
        detailsAttempted++;
        const dres = await ctx.fetch(embedUrlByAnimalId.get(dog.sourceAnimalId) ?? dog.originalUrl);
        detailPagesVisited++;
        if (dres.ok) {
          const { kennelDescription } = parseAnimalDetailPage(dres.text);
          dog.biographyRaw = kennelDescription;
          dog.detailFetched = true;
        } else {
          detailFailures++;
          warnings.push(`detail HTTP ${dres.status} for ${dog.sourceAnimalId}`);
        }
      } catch (err) {
        detailFailures++;
        warnings.push(
          `detail fetch failed for ${dog.sourceAnimalId}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    return {
      dogs,
      totalReportedBySource: dogs.length, // single-call feed IS the complete dog inventory
      pagesVisited: 1,
      detailPagesVisited,
      detailsAttempted,
      detailsSucceeded: detailsAttempted - detailFailures,
      detailsFailed: detailFailures,
      paginationCompleted: true, // one complete response, no pagination
      detailExtractionCompleted: !budgetExhausted && detailFailures === 0,
      warnings,
      paginationTrace: [
        {
          url,
          page: 1,
          resultCount: dogs.length,
          note: `single-call feed; ${all.length} animals all species`,
        },
      ],
      htmlHash,
    };
  },
};
