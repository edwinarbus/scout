import * as cheerio from "cheerio";
import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { absUrl, htmlToText, squish } from "./helpers";
import { parseYesNo } from "@/lib/normalize";
import { hashObject, sha256 } from "@/lib/hash";

/**
 * Oakland Animal Services — WordPress "pet portal" backed by RescueGroups.
 * The dogs page server-renders EVERY current dog as #animalCell-{id} divs
 * with rich data attributes (name, sex, weight, exact age, shelter/foster,
 * intake date, identifier); client JS only filters. Single page, no pager.
 *
 * Detail: /adopt/animal?animalId={id} — full breed, color, age, size
 * potential, current weight, spay/neuter, microchip, vaccination, location,
 * biography, and a multi-photo RescueGroups gallery.
 *
 * The site returns 403 to non-browser user agents, so this source runs with
 * browser-profile headers (operator decision recorded on the source row).
 */

export const OAKLAND_PARSER_VERSION = "oakland-1.0.0";

export interface OaklandCard {
  identifier: string;
  name: string | null;
  sizeGeneral: string | null;
  weight: string | null;
  sex: string | null;
  exactAge: string | null;
  ageBucket: string | null;
  location: string | null; // "Shelter" | "Foster"
  intake: string | null; // "01/31/2022"
  breedLine: string | null; // "Adult, 47.0 lbs, Female, Australian Cattle Dog/..."
  photoUrl: string | null;
  detailPath: string;
}

export function parseListingPage(html: string, base: string): OaklandCard[] {
  const $ = cheerio.load(html);
  const cards: OaklandCard[] = [];
  $("div.animalCell").each((_, el) => {
    const $el = $(el);
    const identifier = $el.attr("data-identifier");
    if (!identifier) return;
    const detailHref =
      $el.find("a[href*='animalId=']").attr("href") ?? `/adopt/animal?animalId=${identifier}`;
    // Third detail line holds "Adult, 47.0 lbs, Female, Breed/..."
    const lines = $el
      .find(".animalCellDetail")
      .map((_i, d) => squish($(d).text()))
      .get()
      .filter(Boolean);
    const breedLine = lines.find((l) => /,/.test(l!) && /lbs/i.test(l!)) ?? null;
    cards.push({
      identifier,
      name: squish($el.attr("data-name")),
      sizeGeneral: squish($el.attr("data-sizegeneral")),
      weight: squish($el.attr("data-size")),
      sex: squish($el.attr("data-sex")),
      exactAge: squish($el.attr("data-exactage")),
      ageBucket: squish($el.attr("data-age")),
      location: squish($el.attr("data-location")),
      intake: squish($el.attr("data-intake")),
      breedLine,
      photoUrl: absUrl(base, $el.find("img.animalImage").attr("src")),
      detailPath: detailHref,
    });
  });
  return cards;
}

export interface OaklandDetail {
  fields: Record<string, string>;
  bio: string | null;
  photoUrls: string[];
}

export function parseDetailPage(html: string): OaklandDetail {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  // Facts render as "Label: | value" runs in the animal detail table/blocks.
  const text = htmlToText($("#animalsAvailable").html() ?? $("body").html()) ?? "";
  const grab = (label: string) => {
    const m = text.match(new RegExp(label + ":?\\??\\s*\\n?\\s*([^\\n]+)"));
    return m ? squish(m[1]) : null;
  };
  const pairs: Array<[string, string | null]> = [
    ["Breed", grab("Breed")],
    ["Color", grab("Color")],
    ["Age", grab("Age")],
    ["Size Potential", grab("Size Potential")],
    ["Current Weight", grab("Current Weight")],
    ["Sex", grab("Sex")],
    ["Spayed/Neutered", grab("Spayed/Neutered")],
    ["Location", grab("Location")],
    ["Microchipped", grab("Microchipped")],
    ["Vaccinations", grab("Up-to-date on vaccinations")],
  ];
  for (const [k, v] of pairs) if (v) fields[k] = v;

  // Bio: longest paragraph-ish text block after the facts.
  let bio: string | null = null;
  $("#animalsAvailable p, .entry-content p").each((_, el) => {
    const t = squish($(el).text());
    if (t && t.length > 100 && (!bio || t.length > bio.length) && !/adoption hours|questionnaire/i.test(t)) {
      bio = t;
    }
  });

  const photoUrls: string[] = [];
  $("img[src*='cdn.rescuegroups.org']").each((_, el) => {
    const u = $(el).attr("src")?.replace(/\?width=\d+/, "?width=720");
    if (u && !photoUrls.includes(u)) photoUrls.push(u);
  });
  return { fields, bio, photoUrls };
}

export const oaklandAdapter: SourceAdapter = {
  system: "direct_html",
  parserVersion: OAKLAND_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = (source.baseUrl ?? "https://www.oaklandanimalservices.org").replace(/\/$/, "");
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];

    const res = await ctx.fetch(source.listingUrl);
    if (!res.ok) throw new Error(`listing page HTTP ${res.status}`);
    const htmlHash = sha256(res.text);
    ctx.saveDebug("listing.html", res.text);
    const cards = parseListingPage(res.text, base);
    trace.push({
      url: source.listingUrl,
      page: 1,
      resultCount: cards.length,
      note: "single server-rendered page (client-side filters only)",
    });
    if (cards.length === 0) {
      warnings.push("zero animalCell divs parsed — markup may have changed");
    }

    const dogs: ExtractedDog[] = [];
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let budgetExhausted = false;
    const seen = new Set<string>();

    for (const card of cards) {
      if (seen.has(card.identifier)) continue;
      seen.add(card.identifier);
      const originalUrl = absUrl(base, card.detailPath)!;
      const cardFingerprint = hashObject(card);
      const wantDetail = ctx.shouldFetchDetail(card.identifier, cardFingerprint);

      let detail: OaklandDetail | null = null;
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
            const dres = await ctx.fetch(originalUrl);
            detailPagesVisited++;
            if (dres.ok) detail = parseDetailPage(dres.text);
            else {
              detailFailures++;
              warnings.push(`detail HTTP ${dres.status} for ${card.identifier}`);
            }
          } catch (err) {
            detailFailures++;
            warnings.push(
              `detail fetch failed for ${card.identifier}: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }

      const f = detail?.fields ?? {};
      // Card breed line: "Adult, 47.0 lbs, Female, Australian Cattle Dog/..."
      const cardBreed = card.breedLine?.split(",").slice(3).join(",") ?? null;
      const photos = detail?.photoUrls.length
        ? detail.photoUrls
        : card.photoUrl
          ? [card.photoUrl]
          : [];
      const inFoster = /foster/i.test(card.location ?? "") || /foster/i.test(f["Location"] ?? "");

      dogs.push({
        sourceAnimalId: card.identifier,
        originalUrl,
        name: card.name,
        species: "Dog",
        breedRaw: f["Breed"] ?? squish(cardBreed?.replace(/\/\s*\.\.\.$/, "")),
        ageRaw: f["Age"] ?? (card.exactAge ? `${card.exactAge} y/o` : card.ageBucket),
        sexRaw: f["Sex"] ?? card.sex,
        sizeRaw: f["Size Potential"] ?? card.sizeGeneral,
        weightRaw: f["Current Weight"] ?? (card.weight ? `${card.weight} lbs` : null),
        colorRaw: f["Color"] ?? null,
        statusRaw: inFoster ? "Available - In Foster" : "Available (listed)",
        intakeDateRaw: card.intake,
        shelterName: source.name,
        shelterLocationName: inFoster ? "In Foster (Oakland area)" : "Oakland Animal Services",
        city: "Oakland",
        county: "Alameda",
        state: "CA",
        primaryPhotoUrl: photos[0] ?? null,
        photoUrls: photos,
        biographyRaw: detail?.bio ?? null,
        fosterNotes: inFoster
          ? "In a foster home — adoption via questionnaire/adoption events."
          : null,
        spayedNeutered: parseYesNo(f["Spayed/Neutered"]),
        microchipped: parseYesNo(f["Microchipped"]),
        vaccinated: parseYesNo(f["Vaccinations"]),
        rawPayload: {
          card: card as unknown as Record<string, unknown>,
          detailFields: f,
        },
        cardFingerprint,
        detailFetched: detail != null,
      });
    }

    const detailExtractionCompleted = !budgetExhausted && detailFailures === 0;

    return {
      dogs,
      totalReportedBySource: cards.length, // the page lists the full inventory
      pagesVisited: 1,
      detailPagesVisited,
      detailsAttempted,
      detailsSucceeded: detailsAttempted - detailFailures,
      detailsFailed: detailFailures,
      paginationCompleted: true,
      detailExtractionCompleted,
      warnings,
      paginationTrace: trace,
      htmlHash,
    };
  },
};
