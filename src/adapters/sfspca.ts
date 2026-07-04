import * as cheerio from "cheerio";
import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { htmlToText, squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";

/**
 * SF SPCA — first-party WordPress REST endpoint:
 *   GET https://www.sfspca.org/wp-json/sfspca/v1/adoption?page=N
 *   → { pagination: { currentPage, maxPages, results }, items: [...] }
 *   The page param is 1-BASED: page=0 and page=1 both return the first page
 *   (verified live 2026-07-01 — a 0-based loop silently drops the last page).
 * Items are all species (the species query param is ignored server-side), so
 * we fetch every page and filter to dogs. Cards carry name/gender/weight
 * category/breed/color/kennel/site/permalink/thumb; the permalink detail page
 * adds Age, exact Weight, and the biography.
 */

export const SFSPCA_PARSER_VERSION = "sfspca-1.0.0";

const API_PATH = "/wp-json/sfspca/v1/adoption";

/** Adoption sites (campus precision, approximate). */
const SITES: Record<string, { city: string; lat: number; lng: number }> = {
  "mission adoption center": { city: "San Francisco", lat: 37.7649, lng: -122.4117 },
  "pacific heights campus": { city: "San Francisco", lat: 37.7925, lng: -122.4382 },
};

export interface SfspcaItem {
  title: string | null;
  tags: {
    gender?: string | null;
    "weight-category"?: string | null;
    species?: string | null;
    breed?: string | null;
    color?: string | null;
    location?: string | null;
    site?: string | null;
  } | null;
  permalink: string | null;
  thumb: string | null;
  bonded: boolean | null;
}

export interface SfspcaDetail {
  ageRaw: string | null;
  weightRaw: string | null;
  bio: string | null;
  photoUrls: string[];
}

export function parseDetailPage(html: string): SfspcaDetail {
  const $ = cheerio.load(html);
  // Facts render as "Age: | 3 m | Weight: | 3 lbs; 14 oz | Gender ..." label/value pairs.
  const bodyText = htmlToText($("main").html() ?? $("body").html()) ?? "";
  const ageRaw = bodyText.match(/Age:\s*\n?\s*([^\n]+)/)?.[1] ?? null;
  const weightRaw = bodyText.match(/Weight:\s*\n?\s*([^\n]+)/)?.[1] ?? null;
  // Bio: the longest paragraph blob in the entry content.
  let bio: string | null = null;
  $("main p, .entry-content p, article p").each((_, el) => {
    const t = squish($(el).text());
    if (t && t.length > 80 && (!bio || t.length > bio.length) && !/cookie|newsletter/i.test(t)) {
      bio = t;
    }
  });
  const photoUrls: string[] = [];
  $("img[src*='/wp-content/uploads/']").each((_, el) => {
    const u = $(el).attr("src");
    if (
      u &&
      !photoUrls.includes(u) &&
      !/logo|icon|badge|guidestar/i.test(u) &&
      /uploads\/\d{4}\//.test(u)
    ) {
      photoUrls.push(u);
    }
  });
  return { ageRaw: squish(ageRaw), weightRaw: squish(weightRaw), bio, photoUrls };
}

export function animalIdFromPermalink(permalink: string | null): string | null {
  return permalink?.match(/\/sfspca-adoption\/(\d+)/)?.[1] ?? null;
}

export const sfspcaAdapter: SourceAdapter = {
  system: "direct_html",
  parserVersion: SFSPCA_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = (source.baseUrl ?? "https://www.sfspca.org").replace(/\/$/, "");
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];

    const itemsById = new Map<string, SfspcaItem>();
    let htmlHash: string | null = null;
    let pagesVisited = 0;
    let paginationCompleted = false;
    let maxPages: number | null = null;
    let allSpeciesTotal: number | null = null;

    for (let page = 1; page <= ctx.limits.maxPages; page++) {
      const url = `${base}${API_PATH}?page=${page}`;
      const res = await ctx.fetch(url, { headers: { Accept: "application/json" } });
      pagesVisited++;
      if (!res.ok) {
        warnings.push(`adoption API page ${page} returned HTTP ${res.status}`);
        trace.push({ url, page, resultCount: 0, note: `HTTP ${res.status}` });
        break;
      }
      if (page === 1) {
        htmlHash = sha256(res.text);
        ctx.saveDebug("adoption-page1.json", res.text);
      }
      let data: {
        pagination?: { currentPage: number; maxPages: number; results: number };
        items?: SfspcaItem[];
      };
      try {
        data = JSON.parse(res.text);
      } catch {
        warnings.push(`adoption API page ${page} returned non-JSON`);
        break;
      }
      maxPages = data.pagination?.maxPages ?? maxPages;
      allSpeciesTotal = data.pagination?.results ?? allSpeciesTotal;
      const items = data.items ?? [];
      for (const it of items) {
        const id = animalIdFromPermalink(it.permalink) ?? it.permalink ?? it.title ?? "";
        if (id && !itemsById.has(id)) itemsById.set(id, it);
      }
      trace.push({
        url,
        page,
        resultCount: items.length,
        note: `all-species; maxPages=${data.pagination?.maxPages}, results=${data.pagination?.results}`,
      });
      if (maxPages != null && page >= maxPages) {
        paginationCompleted = true;
        break;
      }
      if (items.length === 0) {
        paginationCompleted = page > 1;
        if (page === 1) warnings.push("zero items on first page — API may have changed");
        break;
      }
      if (page === ctx.limits.maxPages) {
        warnings.push(`pagination stopped at maxPagesPerRun=${ctx.limits.maxPages}`);
      }
    }
    if (allSpeciesTotal != null && itemsById.size < allSpeciesTotal && paginationCompleted) {
      warnings.push(
        `API reported ${allSpeciesTotal} animals (all species) but ${itemsById.size} were extracted`
      );
    }

    const dogItems = [...itemsById.values()].filter(
      (it) => (it.tags?.species ?? "").toLowerCase() === "dog"
    );
    ctx.log(`API: ${itemsById.size} animals all species, ${dogItems.length} dogs`);

    const dogs: ExtractedDog[] = [];
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let budgetExhausted = false;

    for (const it of dogItems) {
      const originalUrl = it.permalink ?? `${base}/adoptions/dogs/`;
      const animalId = animalIdFromPermalink(it.permalink);
      const cardFingerprint = hashObject(it);
      const listingKey = animalId ?? originalUrl;
      const wantDetail = it.permalink != null && ctx.shouldFetchDetail(listingKey, cardFingerprint);

      let detail: SfspcaDetail | null = null;
      if (wantDetail) {
        if (detailPagesVisited >= ctx.limits.maxDetailPages) {
          if (!budgetExhausted) {
            warnings.push(
              `detail page budget (${ctx.limits.maxDetailPages}) exhausted; remaining dogs saved card-only`
            );
            budgetExhausted = true;
          }
        } else {
          try {
            detailsAttempted++;
            const res = await ctx.fetch(it.permalink!);
            detailPagesVisited++;
            if (res.ok) detail = parseDetailPage(res.text);
            else {
              detailFailures++;
              warnings.push(`detail HTTP ${res.status} for ${animalId ?? it.title}`);
            }
          } catch (err) {
            detailFailures++;
            warnings.push(
              `detail fetch failed for ${animalId ?? it.title}: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }

      const site = it.tags?.site ? SITES[it.tags.site.toLowerCase()] : undefined;
      const photos = detail?.photoUrls.length
        ? detail.photoUrls
        : it.thumb
          ? [it.thumb]
          : [];

      dogs.push({
        sourceAnimalId: animalId,
        originalUrl,
        name: squish(it.title),
        species: it.tags?.species ?? "Dog",
        breedRaw: squish(it.tags?.breed),
        ageRaw: detail?.ageRaw ?? null,
        sexRaw: squish(it.tags?.gender),
        sizeRaw: squish(it.tags?.["weight-category"]),
        weightRaw: detail?.weightRaw ?? null,
        colorRaw: squish(it.tags?.color),
        statusRaw: "Adoptable (listed)",
        shelterName: it.tags?.site ? `SF SPCA - ${it.tags.site}` : source.name,
        shelterLocationName: squish(it.tags?.site),
        city: site?.city ?? "San Francisco",
        county: "San Francisco",
        state: "CA",
        latitude: site?.lat ?? null,
        longitude: site?.lng ?? null,
        geocodePrecision: site ? "campus" : null,
        primaryPhotoUrl: photos[0] ?? null,
        photoUrls: photos,
        biographyRaw: detail?.bio ?? null,
        urgentNotes: it.bonded ? "Bonded pair — adopts together." : null,
        rawPayload: { card: it as unknown as Record<string, unknown> },
        cardFingerprint,
        detailFetched: detail != null,
      });
    }

    const detailExtractionCompleted = !budgetExhausted && detailFailures === 0;

    return {
      dogs,
      // The API total is all-species; publishing it as a dog total would create
      // false count mismatches, so no reported total is claimed.
      totalReportedBySource: null,
      pagesVisited,
      detailPagesVisited,
      detailsAttempted,
      detailsSucceeded: detailsAttempted - detailFailures,
      detailsFailed: detailFailures,
      paginationCompleted,
      detailExtractionCompleted,
      warnings,
      paginationTrace: trace,
      htmlHash,
    };
  },
};
