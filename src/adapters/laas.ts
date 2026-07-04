import * as cheerio from "cheerio";
import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { absUrl, isPlaceholderPhotoUrl, squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";
import { parseLooseDate, toIsoDate } from "@/lib/normalize";

/**
 * LA Animal Services (custom_laas) — Drupal 10 behind Akamai.
 *
 * Listing:  https://www.laanimalservices.com/search/dogs?page=N   (page is 0-based)
 *   - .views-row .pet-result cards: name link (/pet/aXXXXXXX), .pet-result__id,
 *     PetHarbor photo (…get_image.asp?ID=A2282226&LOCATION=LACT5).
 *   - .pager: pager__item--last → last page index; pager__item--next presence.
 * Detail:   https://www.laanimalservices.com/pet/aXXXXXXX
 *   - .pet-details__card-row property/value pairs: Animal ID, Sex, Size, Color,
 *     Breed, Lifestage, Care Status, Available (date), Location (+since, address).
 *
 * Access notes (operator decisions, also recorded on the source row):
 *   - The CDN returns 403 to non-browser user agents, so this adapter runs
 *     with browser-profile headers (source.useBrowserHeaders).
 *   - robots.txt is Drupal's unmodified stock template; its /search/ disallow
 *     targets the core search module. The source's robotsOverrideReason
 *     documents proceeding at low frequency; /pet/ pages are not disallowed.
 */

export const LAAS_PARSER_VERSION = "laas-1.0.0";

/** Approximate coordinates for LAAS's six shelters (map-display quality). */
const LAAS_SHELTERS: Record<string, { city: string; lat: number; lng: number }> = {
  "east valley": { city: "Van Nuys", lat: 34.1937, lng: -118.4512 },
  "west valley": { city: "Chatsworth", lat: 34.2532, lng: -118.5896 },
  "north central": { city: "Los Angeles", lat: 34.0846, lng: -118.2231 },
  "chesterfield square": { city: "Los Angeles", lat: 33.9855, lng: -118.308 },
  "south la": { city: "Los Angeles", lat: 33.9855, lng: -118.308 },
  harbor: { city: "San Pedro", lat: 33.7594, lng: -118.2923 },
  "west la": { city: "Los Angeles", lat: 34.0361, lng: -118.4429 },
  "west los angeles": { city: "Los Angeles", lat: 34.0361, lng: -118.4429 },
};

export interface LaasCard {
  petPath: string; // "/pet/a2282226"
  animalId: string | null; // "A2282226"
  name: string | null;
  photoUrl: string | null;
}

export function parseListingPage(html: string, base: string) {
  const $ = cheerio.load(html);
  const cards: LaasCard[] = [];
  $(".pet-result").each((_, el) => {
    const $el = $(el);
    const href = $el.find("a.pet-result__link").attr("href");
    if (!href || !href.startsWith("/pet/")) return;
    cards.push({
      petPath: href,
      animalId: squish($el.find(".pet-result__id").text()),
      name: squish($el.find("a.pet-result__link").text()),
      photoUrl: absUrl(base, $el.find("img.pet-result__image").attr("src")),
    });
  });
  // pager: last page index + whether a next link exists
  const lastHref = $(".pager__item--last a").attr("href");
  const lastPage = lastHref?.match(/page=(\d+)/)?.[1];
  const hasNext = $(".pager__item--next a").length > 0;
  return { cards, lastPage: lastPage != null ? +lastPage : null, hasNext };
}

export interface LaasDetail {
  fields: Record<string, string>;
  locationName: string | null;
  locationSince: string | null;
  locationAddress: string | null;
  bio: string | null;
  photoUrls: string[];
}

export function parseDetailPage(html: string, base: string): LaasDetail {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $(".pet-details__card-row").each((_, el) => {
    const label = squish($(el).find(".pet-details__card-property").text())?.replace(/:$/, "");
    const value = squish($(el).find(".pet-details__card-value").text());
    if (label && value && !(label in fields)) fields[label] = value;
  });
  // "Location | West Valley since Jul 01, 2026 | 20655 Plummer St. Chatsworth, CA 91311 (888)..."
  const rawLoc = fields["Location"] ?? null;
  let locationName: string | null = null;
  let locationSince: string | null = null;
  let locationAddress: string | null = null;
  if (rawLoc) {
    const m = rawLoc.match(/^(.*?)\s+since\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\s*(.*)$/);
    if (m) {
      locationName = squish(m[1]);
      locationSince = squish(m[2]);
      locationAddress = squish(m[3]?.replace(/\(\d{3}\).*$/, "")); // strip trailing phone
    } else {
      locationName = rawLoc;
    }
  }
  // LAAS municipal detail pages carry no narrative biography — the only prose
  // block, .pet-details__others, is the "You may also like…" related-dogs
  // widget (other animals' names + shelters), NOT a description. Never treat it
  // as a bio; LAAS dogs simply have bio = null.
  const bio: string | null = null;
  const photoUrls: string[] = [];
  $("img[src*='petharbor.com'], .pet-details__photo img, .pet-details__photo-img img").each(
    (_, el) => {
      const u = absUrl(base, $(el).attr("src"));
      if (u && !photoUrls.includes(u)) photoUrls.push(u);
    }
  );
  return { fields, locationName, locationSince, locationAddress, bio, photoUrls };
}

export const laasAdapter: SourceAdapter = {
  system: "custom_laas",
  parserVersion: LAAS_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = (source.baseUrl ?? "https://www.laanimalservices.com").replace(/\/$/, "");
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];
    const cardsByPath = new Map<string, LaasCard>();

    let htmlHash: string | null = null;
    let pagesVisited = 0;
    let paginationCompleted = false;
    let lastPageSeen: number | null = null;

    for (let page = 0; page < ctx.limits.maxPages; page++) {
      const url = `${base}/search/dogs${page > 0 ? `?page=${page}` : ""}`;
      const res = await ctx.fetch(url);
      pagesVisited++;
      if (!res.ok) {
        warnings.push(`listing page ${page} returned HTTP ${res.status}`);
        trace.push({ url, page: page + 1, resultCount: 0, note: `HTTP ${res.status}` });
        break;
      }
      if (page === 0) {
        htmlHash = sha256(res.text);
        ctx.saveDebug("listing-page0.html", res.text);
      }
      const { cards, lastPage, hasNext } = parseListingPage(res.text, base);
      if (lastPage != null) lastPageSeen = lastPage;
      const before = cardsByPath.size;
      for (const c of cards) cardsByPath.set(c.petPath, c);
      trace.push({
        url,
        page: page + 1,
        resultCount: cards.length,
        note: `${cardsByPath.size - before} new${lastPage != null ? `, last page index ${lastPage}` : ""}${hasNext ? "" : ", no next link"}`,
      });
      if (cards.length === 0) {
        if (page === 0) warnings.push("zero cards on first page — markup may have changed");
        paginationCompleted = page > 0; // an empty page past the start = ran off the end
        break;
      }
      if (!hasNext) {
        paginationCompleted = true;
        break;
      }
      if (page === ctx.limits.maxPages - 1) {
        warnings.push(
          `pagination stopped at maxPagesPerRun=${ctx.limits.maxPages} with next link still present`
        );
      }
    }
    if (lastPageSeen != null && pagesVisited < lastPageSeen + 1 && paginationCompleted) {
      warnings.push(
        `pager advertised ${lastPageSeen + 1} pages but only ${pagesVisited} were visited`
      );
      paginationCompleted = false;
    }

    const dogs: ExtractedDog[] = [];
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let budgetExhausted = false;

    for (const card of cardsByPath.values()) {
      const originalUrl = `${base}${card.petPath}`;
      const cardFingerprint = hashObject(card);
      const listingKey = card.animalId ?? card.petPath.replace("/pet/", "").toUpperCase();
      const wantDetail = ctx.shouldFetchDetail(listingKey, cardFingerprint);

      let detail: LaasDetail | null = null;
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
            const res = await ctx.fetch(originalUrl);
            detailPagesVisited++;
            if (res.ok) detail = parseDetailPage(res.text, base);
            else {
              detailFailures++;
              warnings.push(`detail HTTP ${res.status} for ${card.petPath}`);
            }
          } catch (err) {
            detailFailures++;
            warnings.push(
              `detail fetch failed for ${card.petPath}: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }

      const f = detail?.fields ?? {};
      // Location names can be compound ("Chesterfield Square / South LA") —
      // match by contained key rather than exact equality.
      const locLower = detail?.locationName?.toLowerCase() ?? "";
      const shelter = locLower
        ? Object.entries(LAAS_SHELTERS).find(([k]) => locLower.includes(k))?.[1]
        : undefined;
      const photos = (
        detail?.photoUrls.length ? detail.photoUrls : card.photoUrl ? [card.photoUrl] : []
      ).filter((u) => !isPlaceholderPhotoUrl(u));

      dogs.push({
        sourceAnimalId: f["Animal ID"] ?? card.animalId,
        originalUrl,
        name: card.name,
        species: "Dog",
        breedRaw: f["Breed"] ?? null,
        ageRaw: f["Lifestage"] ?? null, // e.g. "Senior Dog: 7+ yrs." — kept raw, bucket-parsed
        sexRaw: f["Sex"] ?? null,
        sizeRaw: f["Size"] ?? null,
        weightRaw: f["Weight"] ?? null,
        colorRaw: f["Color"] ?? null,
        // Card-only extractions carry no status/shelter info — emit null so
        // the runner's merge preserves previously captured detail values.
        statusRaw: detail ? (f["Care Status"] ?? "Adoptable (listed in search)") : null,
        availabilityDateRaw: f["Available"] ?? null,
        // LAAS's best "in shelter since" signal is the detail page's
        // "Location: {shelter} since {date}" — used for days-in-shelter.
        intakeDateRaw: detail?.locationSince
          ? toIsoDate(parseLooseDate(detail.locationSince))
          : null,
        shelterName: detail?.locationName
          ? `LA Animal Services - ${detail.locationName}`
          : detail
            ? source.name
            : null,
        shelterLocationName: detail?.locationName ?? null,
        address: detail?.locationAddress ?? null,
        city: shelter?.city ?? null,
        county: "Los Angeles",
        state: "CA",
        latitude: shelter?.lat ?? null,
        longitude: shelter?.lng ?? null,
        geocodePrecision: shelter ? "campus" : null,
        primaryPhotoUrl: photos[0] ?? null,
        photoUrls: photos,
        biographyRaw: detail?.bio ?? null,
        spayedNeutered: f["Sex"] ? /spayed|neutered/i.test(f["Sex"]) || null : null,
        rawPayload: {
          card: card as unknown as Record<string, unknown>,
          detailFields: f,
          locationSince: detail?.locationSince ?? null,
        },
        cardFingerprint,
        detailFetched: detail != null,
      });
    }

    const detailExtractionCompleted = !budgetExhausted && detailFailures === 0;

    return {
      dogs,
      // The pager reports pages, not a total record count — no reported total.
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
