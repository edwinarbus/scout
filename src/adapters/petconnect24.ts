import * as cheerio from "cheerio";
import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { absUrl, htmlToText, isPlaceholderPhotoUrl, looksLikeNonDog, squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";
import { cityCoords } from "@/lib/geo";
import { parseLooseDate, toIsoDate } from "@/lib/normalize";

/**
 * 24Petconnect (HLP/Pethealth) adapter.
 *
 * Listing:  https://24petconnect.com/{Tenant}?at=DOG[&index=N]
 *   - server-rendered div.gridResult cards
 *   - "<h3 id=AnimalCountHeader>Animals: 1 - 17 of 17</h3>" drives pagination
 *     (?index= is the 0-based offset of the next page) and completeness audit.
 * Detail:   https://24petconnect.com/{Tenant}/Details/{ShelterCode}/{AnimalId}
 *   - description sentence ("I am a spayed female, black Labrador ...") yields
 *     sex/altered/color; MoreInfo yields intake date + biography; a shelter
 *     info box yields address/phone/website (captured into rawPayload).
 *
 * One adapter serves every 24Petconnect tenant; the tenant comes from the
 * source's listingUrl.
 */

export const PETCONNECT24_PARSER_VERSION = "petconnect24-1.0.0";

interface CardData {
  animalId: string;
  tenant: string;
  shelterCode: string;
  name: string | null;
  gender: string | null;
  breed: string | null;
  age: string | null;
  weight: string | null;
  locatedAt: string | null;
  kennel: string | null;
  viewType: string | null;
  photoUrl: string | null;
}

function parseCountHeader(html: string): { start: number; end: number; total: number } | null {
  const m = html.match(/Animals:\s*(\d+)\s*-\s*(\d+)\s*of\s*(\d+)/i);
  if (!m) return null;
  return { start: +m[1], end: +m[2], total: +m[3] };
}

function parseCards($: cheerio.CheerioAPI, baseUrl: string): CardData[] {
  const cards: CardData[] = [];
  $(".gridResult").each((_, el) => {
    const $el = $(el);
    const onclick = $el.attr("onclick") ?? "";
    const m = onclick.match(/Details\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/);
    if (!m) return;
    const [, tenant, shelterCode, animalId] = m;
    const img = $el.find("img").attr("src");
    cards.push({
      animalId,
      tenant,
      shelterCode,
      name: squish($el.find(".text_Name").text()),
      gender: squish($el.find(".text_Gender").text()),
      breed: squish($el.find(".text_Breed").text()),
      age: squish($el.find(".text_Age").text()),
      weight: squish($el.find(".text_Weight").text()),
      locatedAt: squish($el.find(".text_Locatedat").text()),
      kennel: squish($el.find('[class^="text_Kennel"]').text()),
      viewType: squish($el.find(".text_ViewType").text()),
      photoUrl: absUrl(baseUrl, img),
    });
  });
  return cards;
}

interface DetailData {
  descriptionSentence: string | null;
  ageSentence: string | null;
  moreInfo: string | null;
  locatedAt: string | null;
  shelterWebsite: string | null;
  shelterPhone: string | null;
  shelterAddress: string | null;
  shelterExtraInfo: string | null;
  photoUrls: string[];
}

export function parseDetailPage(html: string, baseUrl: string): DetailData {
  const $ = cheerio.load(html);
  const photoUrls: string[] = [];
  $("img[src^='/image/'], img[src*='24petconnect.com/image/']").each((_, el) => {
    const u = absUrl(baseUrl, $(el).attr("src"));
    if (u && !photoUrls.includes(u)) photoUrls.push(u);
  });
  return {
    descriptionSentence: squish($(".text_Description.details").text()),
    ageSentence: squish($(".text_Age.details").text()),
    moreInfo: htmlToText($(".text_MoreInfo.details").html()),
    locatedAt: squish($(".text_LocatedAt.details").text()),
    shelterWebsite: absUrl(baseUrl, $(".text_Website a").attr("href")),
    shelterPhone: squish($(".text_PhoneNumber").text()),
    shelterAddress: htmlToText($(".text_Address").html()),
    shelterExtraInfo: htmlToText($(".text_ExtraInformation").html()),
    photoUrls,
  };
}

/** Color vocabulary for splitting "{color} {breed}" when the card has no breed column. */
const COLOR_WORDS = new Set([
  "black", "white", "brown", "chocolate", "gray", "grey", "silver", "yellow",
  "gold", "golden", "blonde", "red", "orange", "cream", "buff", "tan", "fawn",
  "apricot", "brindle", "merle", "blue", "liver", "seal", "sable", "tricolor",
  "tri", "brn", "blk", "wht", "and", "&", ",", "/",
]);

/** "My name is X and I am a spayed female, black Labrador Retriever and Belgian Malinois." */
export function parseDescriptionSentence(
  sentence: string | null,
  cardBreed: string | null
): { sexRaw: string | null; colorRaw: string | null; breedFromSentence: string | null } {
  if (!sentence) return { sexRaw: null, colorRaw: null, breedFromSentence: null };
  const m = sentence.match(
    /I am an?\s+((?:spayed|neutered|unaltered|intact)\s+)?(male|female)\s*,?\s*([^.]*)/i
  );
  if (!m) return { sexRaw: null, colorRaw: null, breedFromSentence: null };
  const sexRaw = squish(`${m[1] ?? ""}${m[2]}`);
  let colorRaw: string | null = null;
  let breedFromSentence: string | null = null;
  const rest = squish(m[3]);
  if (rest && cardBreed) {
    // rest = "{color} {breed}"; strip the known breed suffix to isolate color.
    const idx = rest.toLowerCase().indexOf(cardBreed.toLowerCase());
    if (idx > 0) colorRaw = squish(rest.slice(0, idx));
  } else if (rest) {
    // No card breed (some tenants hide that column): consume leading color
    // words; the remainder is the breed. Deterministic against a fixed
    // vocabulary — the full sentence stays in rawPayload either way.
    const words = rest.split(/\s+/);
    let i = 0;
    while (i < words.length && COLOR_WORDS.has(words[i].toLowerCase().replace(/[,/]/g, ""))) i++;
    if (i > 0 && i < words.length) {
      colorRaw = squish(words.slice(0, i).join(" ").replace(/\s+and\s*$/i, ""));
      breedFromSentence = squish(words.slice(i).join(" "));
    } else if (i === 0 && words.length) {
      breedFromSentence = rest; // no leading color words — treat it all as breed
    }
  }
  return { sexRaw, colorRaw, breedFromSentence };
}

/** "I have been at the shelter since Jun 27, 2026." */
export function parseIntakeDate(moreInfo: string | null): string | null {
  if (!moreInfo) return null;
  const m = moreInfo.match(/at the shelter since\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i);
  return m ? toIsoDate(parseLooseDate(m[1])) : null;
}

/** Bio = MoreInfo minus the leading "at the shelter since ..." sentence. */
export function extractBio(moreInfo: string | null): string | null {
  if (!moreInfo) return null;
  const cut = moreInfo.replace(/^I have been at the shelter since[^\n.]*\.?\s*/i, "");
  return squish(cut) ? cut.trim() : null;
}

export const petconnect24Adapter: SourceAdapter = {
  system: "24petconnect",
  parserVersion: PETCONNECT24_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = source.baseUrl ?? "https://24petconnect.com";
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];
    const cardsById = new Map<string, CardData>();

    let htmlHash: string | null = null;
    let total: number | null = null;
    let pagesVisited = 0;
    let paginationCompleted = false;

    // ---- paginate the listing grid --------------------------------------
    let index = 0;
    for (let page = 1; page <= ctx.limits.maxPages; page++) {
      const url = new URL(source.listingUrl);
      if (index > 0) url.searchParams.set("index", String(index));
      const res = await ctx.fetch(url.toString());
      pagesVisited++;
      if (!res.ok) {
        warnings.push(`listing page ${page} returned HTTP ${res.status}`);
        trace.push({ url: url.toString(), page, resultCount: 0, note: `HTTP ${res.status}` });
        break;
      }
      if (page === 1) {
        htmlHash = sha256(res.text);
        ctx.saveDebug("listing-page1.html", res.text);
      }
      const header = parseCountHeader(res.text);
      const $ = cheerio.load(res.text);
      const cards = parseCards($, base);
      for (const c of cards) cardsById.set(c.animalId, c);
      trace.push({
        url: url.toString(),
        page,
        resultCount: cards.length,
        note: header ? `header ${header.start}-${header.end} of ${header.total}` : "no count header",
      });

      if (!header) {
        if (cards.length === 0) {
          warnings.push(`page ${page}: no count header and zero cards — markup may have changed`);
        } else {
          warnings.push(`page ${page}: count header missing; treating single page as complete`);
          paginationCompleted = true;
        }
        break;
      }
      total = header.total;
      if (header.end >= header.total || cards.length === 0) {
        paginationCompleted = true;
        break;
      }
      index = header.end; // ?index= is the offset of the next first item
      if (page === ctx.limits.maxPages) {
        warnings.push(
          `pagination stopped at maxPagesPerRun=${ctx.limits.maxPages} before reaching reported total ${header.total}`
        );
      }
    }

    if (total != null && cardsById.size < total) {
      warnings.push(`extracted ${cardsById.size} cards but source reports ${total}`);
      paginationCompleted = false;
    }

    // ---- detail pages ----------------------------------------------------
    const dogs: ExtractedDog[] = [];
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let detailBudgetExhausted = false;

    for (const card of cardsById.values()) {
      // Belt-and-suspenders species filter (?at=DOG should already filter).
      if (looksLikeNonDog(card.breed)) {
        warnings.push(`skipped non-dog record ${card.animalId} (breed: ${card.breed})`);
        continue;
      }

      const originalUrl = `${base}/${card.tenant}/Details/${card.shelterCode}/${card.animalId}`;
      const cardFingerprint = hashObject(card);
      const wantDetail = ctx.shouldFetchDetail(card.animalId, cardFingerprint);

      let detail: DetailData | null = null;
      if (wantDetail) {
        if (detailPagesVisited >= ctx.limits.maxDetailPages) {
          if (!detailBudgetExhausted) {
            warnings.push(
              `detail page budget (${ctx.limits.maxDetailPages}) exhausted; remaining dogs saved card-only`
            );
            detailBudgetExhausted = true;
          }
        } else {
          try {
            detailsAttempted++;
            const res = await ctx.fetch(originalUrl);
            detailPagesVisited++;
            if (res.ok) {
              detail = parseDetailPage(res.text, base);
            } else {
              detailFailures++;
              warnings.push(`detail HTTP ${res.status} for ${card.animalId}`);
            }
          } catch (err) {
            detailFailures++;
            warnings.push(
              `detail fetch failed for ${card.animalId}: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }

      const { sexRaw, colorRaw, breedFromSentence } = parseDescriptionSentence(
        detail?.descriptionSentence ?? null,
        card.breed
      );

      // Campus city, e.g. "Santa Cruz County Animal Shelter - Watsonville"
      const locatedAt = detail?.locatedAt ?? card.locatedAt;
      let dogCity: string | null = null;
      let dogLat: number | null = null;
      let dogLng: number | null = null;
      const campusCity = locatedAt?.match(/-\s*([A-Za-z .]+)$/)?.[1]?.trim() ?? null;
      if (campusCity && campusCity.toLowerCase() !== (source.city ?? "").toLowerCase()) {
        const cc = cityCoords(campusCity);
        if (cc) {
          dogCity = campusCity;
          dogLat = cc.latitude;
          dogLng = cc.longitude;
        }
      }

      const photoUrls = (
        detail?.photoUrls?.length ? detail.photoUrls : card.photoUrl ? [card.photoUrl] : []
      ).filter((u) => !isPlaceholderPhotoUrl(u));

      dogs.push({
        sourceAnimalId: card.animalId,
        originalUrl,
        name: card.name,
        species: "Dog",
        breedRaw: card.breed ?? breedFromSentence,
        // Prefer the card's age so content hashes are stable whether or not
        // the detail page was fetched this run (the detail sentence carries
        // the same information in prose form; it stays in rawPayload).
        ageRaw: card.age ?? detail?.ageSentence ?? null,
        sexRaw: sexRaw ?? card.gender,
        sizeRaw: null,
        weightRaw: card.weight,
        colorRaw,
        statusRaw: card.viewType ?? "Adoptable (listed)",
        intakeDateRaw: parseIntakeDate(detail?.moreInfo ?? null),
        shelterName: locatedAt ?? source.name,
        shelterLocationName: locatedAt,
        city: dogCity,
        latitude: dogLat,
        longitude: dogLng,
        geocodePrecision: dogLat != null ? "city" : null,
        primaryPhotoUrl: photoUrls[0] ?? null,
        photoUrls,
        biographyRaw: extractBio(detail?.moreInfo ?? null),
        spayedNeutered: sexRaw ? /spayed|neutered/i.test(sexRaw) : null,
        rawPayload: {
          card: card as unknown as Record<string, unknown>,
          detail: detail
            ? {
                descriptionSentence: detail.descriptionSentence,
                ageSentence: detail.ageSentence,
                moreInfo: detail.moreInfo,
                shelterWebsite: detail.shelterWebsite,
                shelterPhone: detail.shelterPhone,
                shelterAddress: detail.shelterAddress,
                shelterExtraInfo: detail.shelterExtraInfo,
              }
            : null,
        },
        cardFingerprint,
        detailFetched: detail != null,
      });
    }

    const detailExtractionCompleted = !detailBudgetExhausted && detailFailures === 0;
    if (detailFailures > 0 && detailFailures >= Math.max(3, dogs.length * 0.2)) {
      warnings.push(`detail extraction failed for ${detailFailures}/${dogs.length} dogs`);
    }

    return {
      dogs,
      totalReportedBySource: total,
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
