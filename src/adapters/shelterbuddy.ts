import * as cheerio from "cheerio";
import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry, TriState } from "@/lib/types";
import { absUrl, htmlToText, looksLikeNonDog, squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";

/**
 * Classic ShelterBuddy (hosted *.shelterbuddy.com, ASP) adapter.
 * Verified against Marin Humane; works for any tenant with the same markup.
 *
 * Search:  GET {base}/search/searchResults.asp?task=search&searchType=4&
 *          animalType=3,16&submitbtn=Find[&tpage=N]
 *          (animalType 3=Dog, 16=Puppy per the tenant's search form)
 * Cards:   .search-results-details-div — name link (animalid=N), breed line,
 *          optional "Spayed / Neutered", "Sex - Age" line, photo.
 * Detail:  /animal/animalDetails.asp?searchType=4&animalid=N — label/value
 *          table (Breed, Second Breed, Sex, Color, Weight, Spayed/Neutered,
 *          Age, Size), suitability icons (presence = true, absence = unknown),
 *          health statements, location/contact block, "A Little Bit About Me".
 */

export const SHELTERBUDDY_PARSER_VERSION = "shelterbuddy-1.0.0";

export interface SbCard {
  animalId: string;
  name: string | null;
  breedLine: string | null;
  sexAgeLine: string | null;
  desexed: boolean | null;
  photoUrl: string | null;
  detailUrl: string;
}

export function parseSearchResults(html: string, base: string): SbCard[] {
  const $ = cheerio.load(html);
  const cards: SbCard[] = [];
  const seen = new Set<string>();
  $(".search-results-details-div").each((_, el) => {
    const $el = $(el);
    const link = $el.find("a[href*='animalDetails.asp']").first();
    const href = link.attr("href");
    const id = href?.match(/animalid=(\d+)/i)?.[1];
    if (!href || !id || seen.has(id)) return;
    seen.add(id);
    // Text lines: name / breed / [Spayed / Neutered] / "Female - 1Yrs 2Mths (approx)"
    const text = htmlToText($el.html()) ?? "";
    const lines = text
      .split(/\n/)
      .map((l) => squish(l))
      .filter((l): l is string => !!l && l.toLowerCase() !== "view details");
    const name = squish(link.text());
    const rest = lines.filter((l) => l !== name);
    const desexed = rest.some((l) => /spayed\s*\/\s*neutered/i.test(l)) ? true : null;
    const sexAgeLine = rest.find((l) => /^(male|female)\s*-/i.test(l)) ?? null;
    const breedLine =
      rest.find(
        (l) => !/spayed\s*\/\s*neutered/i.test(l) && !/^(male|female)\s*-/i.test(l)
      ) ?? null;
    const photo = $el
      .closest("td, div")
      .parent()
      .find("img.pic")
      .first()
      .attr("src");
    const imgNearby =
      photo ??
      $el.prevAll(".search-results-image-div").find("img").attr("src") ??
      $el.siblings(".search-results-image-div").find("img").attr("src");
    cards.push({
      animalId: id,
      name,
      breedLine,
      sexAgeLine,
      desexed,
      photoUrl: absUrl(base, imgNearby),
      detailUrl: `${base}/animal/animalDetails.asp?searchType=4&animalid=${id}`,
    });
  });
  return cards;
}

export interface SbDetail {
  fields: Record<string, string>;
  bio: string | null;
  photoUrls: string[];
  okWithCats: TriState;
  okWithDogs: TriState;
  vaccinated: TriState;
  microchipped: TriState;
  healthChecked: TriState;
  locationText: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
}

export function parseAnimalDetail(html: string, base: string): SbDetail {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  // Label/value pairs render as sibling table cells; walk heading cells.
  $("td.viewAnimalHeading, span.viewAnimalHeading").each((_, el) => {
    const label = squish($(el).text())?.replace(/:$/, "");
    if (!label) return;
    const $cell = $(el).closest("td");
    const valueCell = $cell.nextAll("td.viewAnimalCell").first();
    const value = squish(valueCell.text());
    if (value && !(label in fields)) fields[label] = value;
  });
  const bodyText = htmlToText($("body").html()) ?? "";
  // "Animal ID: 306860" — the shelter's public id (URL id differs).
  const shownId = bodyText.match(/Animal ID:?\s*([A-Za-z0-9-]+)/i)?.[1];
  if (shownId) fields["Animal ID"] = shownId;

  const bioHeader = $("h3.viewAnimalHeading")
    .filter((_, el) => /about me/i.test($(el).text()))
    .first();
  const bio = htmlToText(bioHeader.nextAll("p.viewAnimalCell").first().html());

  const photoUrls: string[] = [];
  $("img[src*='/storage/image/'], img[src*='shelterbuddy.com/storage']").each((_, el) => {
    const u = absUrl(base, $(el).attr("src"));
    if (u && !photoUrls.includes(u)) photoUrls.push(u);
  });

  const suit = (icon: string): TriState =>
    $(`img[src*='${icon}']`).length > 0 ? true : null; // absence is unknown, never false

  const has = (phrase: string): TriState =>
    new RegExp(phrase, "i").test(bodyText) ? true : null;

  const locBlock = $("blockquote.viewBlock").first();
  const locText = htmlToText(locBlock.html());
  const phone = locText?.match(/Phone\s*([()0-9 .-]{7,})/i)?.[1] ?? null;
  const address = locText?.match(/Address\s*(.+)/i)?.[1] ?? null;
  const whereText = bodyText.match(/I am at the ([^\n.]+)/i)?.[1] ?? null;

  return {
    fields,
    bio,
    photoUrls,
    okWithCats: suit("loveCats"),
    okWithDogs: suit("loveDogs"),
    vaccinated: has("vaccinations are up to date"),
    microchipped: has("have been microchipped"),
    healthChecked: has("health has been checked"),
    locationText: whereText ? `I am at the ${whereText}` : null,
    contactPhone: squish(phone),
    contactAddress: squish(address),
  };
}

export const shelterbuddyAdapter: SourceAdapter = {
  system: "shelterbuddy",
  parserVersion: SHELTERBUDDY_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = (source.baseUrl ?? new URL(source.listingUrl).origin).replace(/\/$/, "");
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];
    const cardsById = new Map<string, SbCard>();

    let htmlHash: string | null = null;
    let pagesVisited = 0;
    let paginationCompleted = false;

    for (let page = 1; page <= ctx.limits.maxPages; page++) {
      const url =
        `${base}/search/searchResults.asp?task=search&searchType=4&animalType=3%2C16&submitbtn=Find` +
        (page > 1 ? `&tpage=${page}` : "");
      const res = await ctx.fetch(url);
      pagesVisited++;
      if (!res.ok) {
        warnings.push(`search page ${page} returned HTTP ${res.status}`);
        trace.push({ url, page, resultCount: 0, note: `HTTP ${res.status}` });
        break;
      }
      if (page === 1) {
        htmlHash = sha256(res.text);
        ctx.saveDebug("search-page1.html", res.text);
      }
      const cards = parseSearchResults(res.text, base);
      const before = cardsById.size;
      for (const c of cards) cardsById.set(c.animalId, c);
      const newCount = cardsById.size - before;
      trace.push({ url, page, resultCount: cards.length, note: `${newCount} new` });

      const hasNextLink = new RegExp(`tpage=${page + 1}(&|"|')`).test(res.text);
      if (!hasNextLink || newCount === 0 || cards.length === 0) {
        paginationCompleted = true;
        break;
      }
      if (page === ctx.limits.maxPages) {
        warnings.push(`pagination stopped at maxPagesPerRun=${ctx.limits.maxPages} with next link still present`);
      }
    }

    const dogs: ExtractedDog[] = [];
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let budgetExhausted = false;

    for (const card of cardsById.values()) {
      if (looksLikeNonDog(card.breedLine)) {
        warnings.push(`skipped non-dog record ${card.animalId} (${card.breedLine})`);
        continue;
      }
      const cardFingerprint = hashObject(card);
      const wantDetail = ctx.shouldFetchDetail(card.animalId, cardFingerprint);

      let detail: SbDetail | null = null;
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
            const dres = await ctx.fetch(card.detailUrl);
            detailPagesVisited++;
            if (dres.ok) detail = parseAnimalDetail(dres.text, base);
            else {
              detailFailures++;
              warnings.push(`detail HTTP ${dres.status} for animal ${card.animalId}`);
            }
          } catch (err) {
            detailFailures++;
            warnings.push(
              `detail fetch failed for ${card.animalId}: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }

      const f = detail?.fields ?? {};
      const sexAge = card.sexAgeLine?.match(/^(male|female)\s*-\s*(.+)$/i);
      const breeds = [f["Breed"], f["Second Breed"]].filter(Boolean).join(" / ");
      const desexedField = f["Spayed / Neutered"] ?? f["Desexed"];

      dogs.push({
        sourceAnimalId: card.animalId,
        originalUrl: card.detailUrl,
        name: card.name,
        species: "Dog",
        breedRaw: breeds || card.breedLine,
        ageRaw: f["Age"] ?? sexAge?.[2] ?? null,
        sexRaw: f["Sex"] ?? sexAge?.[1] ?? null,
        sizeRaw: f["Size"] ?? null,
        weightRaw: f["Weight"] ?? null,
        colorRaw: f["Color"] ?? f["Colour"] ?? null,
        statusRaw: "Adoptable (listed in search)",
        shelterName: detail?.locationText ? null : source.name,
        shelterLocationName: detail?.locationText ?? null,
        primaryPhotoUrl: card.photoUrl ?? detail?.photoUrls[0] ?? null,
        photoUrls: detail?.photoUrls.length
          ? detail.photoUrls
          : card.photoUrl
            ? [card.photoUrl]
            : [],
        biographyRaw: detail?.bio ?? null,
        goodWithCats: detail?.okWithCats ?? null,
        goodWithDogs: detail?.okWithDogs ?? null,
        spayedNeutered:
          desexedField != null ? /yes/i.test(desexedField) : (card.desexed ?? null),
        vaccinated: detail?.vaccinated ?? null,
        microchipped: detail?.microchipped ?? null,
        contactPhone: detail?.contactPhone ?? null,
        rawPayload: {
          card: card as unknown as Record<string, unknown>,
          detailFields: f,
          shelterAnimalId: f["Animal ID"] ?? null,
          contactAddress: detail?.contactAddress ?? null,
        },
        cardFingerprint,
        detailFetched: detail != null,
      });
    }

    const detailExtractionCompleted = !budgetExhausted && detailFailures === 0;
    if (cardsById.size === 0) {
      warnings.push("zero cards parsed from search results — markup may have changed");
    }

    return {
      dogs,
      totalReportedBySource: null, // classic ShelterBuddy doesn't expose a total count
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
