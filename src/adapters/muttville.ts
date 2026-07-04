import * as cheerio from "cheerio";
import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { absUrl, htmlToText, squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";

/**
 * Muttville Senior Dog Rescue (direct_html).
 *
 * Listing: https://muttville.org/available_mutts — every available dog on one
 * server-rendered page as <article class="card"> linking to /mutt/{slug}.
 * Cards carry only name + photo, so detail pages are required.
 *
 * Detail: /mutt/{slug} — facts block:
 *   #14104<br> Chihuahua<br> Male<br> 9 lbs (small)<br> Est. age: 14 yrs<br> Status: Available
 * plus an .article-content bio and a muttville-media photo gallery.
 */

export const MUTTVILLE_PARSER_VERSION = "muttville-1.0.0";

export interface MuttvilleFacts {
  animalId: string | null;
  breedRaw: string | null;
  sexRaw: string | null;
  weightRaw: string | null;
  sizeRaw: string | null;
  ageRaw: string | null;
  statusRaw: string | null;
  factLines: string[];
}

export function parseFactsBlock(text: string | null): MuttvilleFacts {
  const facts: MuttvilleFacts = {
    animalId: null,
    breedRaw: null,
    sexRaw: null,
    weightRaw: null,
    sizeRaw: null,
    ageRaw: null,
    statusRaw: null,
    factLines: [],
  };
  if (!text) return facts;
  const lines = text
    .split(/\n/)
    .map((l) => squish(l))
    .filter((l): l is string => !!l);
  facts.factLines = lines;
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s*([A-Za-z0-9-]+)$/))) {
      facts.animalId = m[1];
    } else if ((m = line.match(/^est\.?\s*age:?\s*(.+)$/i))) {
      facts.ageRaw = m[1];
    } else if ((m = line.match(/^status:?\s*(.+)$/i))) {
      facts.statusRaw = m[1];
    } else if ((m = line.match(/^(\d+(?:\.\d+)?)\s*lbs?\.?\s*(?:\((\w[\w\s-]*)\))?$/i))) {
      facts.weightRaw = `${m[1]} lbs`;
      facts.sizeRaw = squish(m[2]) ?? null;
    } else if (/^(male|female)$/i.test(line)) {
      facts.sexRaw = line;
    } else if (!facts.breedRaw && !/^(adopt|donate|share)/i.test(line)) {
      facts.breedRaw = line;
    }
  }
  return facts;
}

/** Dedupe gallery variants (…-lg.jpg / …-med.jpg / …-lgsq.jpg) to one -lg URL per photo. */
export function dedupePhotoVariants(urls: string[]): string[] {
  const seen = new Map<string, string>();
  for (const u of urls) {
    const m = u.match(/^(.*\/\d+-\d+)-(lgsq|lg|medsq|med|sq|sm)(\.[a-z]+)$/i);
    if (!m) {
      if (!seen.has(u)) seen.set(u, u);
      continue;
    }
    const key = m[1] + m[3];
    const preferred = `${m[1]}-lg${m[3]}`;
    const existing = seen.get(key);
    if (!existing || (existing !== preferred && /-lg\./.test(preferred))) {
      seen.set(key, u.includes("-lg" + m[3]) ? u : preferred);
    }
  }
  return [...seen.values()];
}

export function parseListingCards(html: string, base: string) {
  const $ = cheerio.load(html);
  const cards: { slug: string; name: string | null; photoUrl: string | null; url: string }[] = [];
  $("article.card").each((_, el) => {
    const $el = $(el);
    const href = $el.find("a[rel='bookmark']").attr("href") ?? $el.find("a").attr("href");
    if (!href || !href.startsWith("/mutt/")) return;
    const url = absUrl(base, href);
    if (!url) return;
    cards.push({
      slug: href.replace("/mutt/", "").replace(/\/$/, ""),
      name: squish($el.find("h4").text()),
      photoUrl: absUrl(base, $el.find("img").attr("src")),
      url,
    });
  });
  return cards;
}

export function parseDetail(html: string, base: string) {
  const $ = cheerio.load(html);
  const name = squish($("h1.big-title").first().text());
  // The facts <p> is the sibling block containing "#<id>"
  let factsText: string | null = null;
  $("p").each((_, el) => {
    const t = htmlToText($(el).html());
    if (t && /^#\s*[A-Za-z0-9-]+/m.test(t) && factsText == null) factsText = t;
  });
  const facts = parseFactsBlock(factsText);
  const bio = htmlToText($(".article-content").first().html());
  const photos: string[] = [];
  $("img[src*='muttville-media'], img[src*='/images/mutts/']").each((_, el) => {
    const u = absUrl(base, $(el).attr("src"));
    if (u && !photos.includes(u)) photos.push(u);
  });
  return { name, facts, bio, photoUrls: dedupePhotoVariants(photos) };
}

export const muttvilleAdapter: SourceAdapter = {
  system: "direct_html",
  parserVersion: MUTTVILLE_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = source.baseUrl ?? "https://muttville.org";
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];

    const res = await ctx.fetch(source.listingUrl);
    if (!res.ok) throw new Error(`listing page HTTP ${res.status}`);
    const htmlHash = sha256(res.text);
    ctx.saveDebug("listing.html", res.text);
    const cards = parseListingCards(res.text, base);
    trace.push({
      url: source.listingUrl,
      page: 1,
      resultCount: cards.length,
      note: "single-page listing (no pagination on this source)",
    });

    if (cards.length === 0) {
      warnings.push("zero cards parsed from listing page — markup may have changed");
    }

    const dogs: ExtractedDog[] = [];
    let detailPagesVisited = 0;
    let detailsAttempted = 0;
    let detailFailures = 0;
    let budgetExhausted = false;

    for (const card of cards) {
      const cardFingerprint = hashObject(card);
      const listingKey = card.slug.match(/-(\d+)$/)?.[1] ?? card.slug;
      const wantDetail = ctx.shouldFetchDetail(listingKey, cardFingerprint);

      let detail: ReturnType<typeof parseDetail> | null = null;
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
            const dres = await ctx.fetch(card.url);
            detailPagesVisited++;
            if (dres.ok) detail = parseDetail(dres.text, base);
            else {
              detailFailures++;
              warnings.push(`detail HTTP ${dres.status} for ${card.slug}`);
            }
          } catch (err) {
            detailFailures++;
            warnings.push(
              `detail fetch failed for ${card.slug}: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }

      const facts = detail?.facts;
      dogs.push({
        sourceAnimalId: facts?.animalId ?? listingKey,
        originalUrl: card.url,
        name: detail?.name ?? card.name,
        species: "Dog",
        breedRaw: facts?.breedRaw ?? null,
        ageRaw: facts?.ageRaw ?? null,
        sexRaw: facts?.sexRaw ?? null,
        sizeRaw: facts?.sizeRaw ?? null,
        weightRaw: facts?.weightRaw ?? null,
        colorRaw: null, // Muttville doesn't publish a structured color field
        statusRaw: facts?.statusRaw ?? null,
        primaryPhotoUrl: card.photoUrl ?? detail?.photoUrls[0] ?? null,
        photoUrls: detail?.photoUrls.length
          ? detail.photoUrls
          : card.photoUrl
            ? [card.photoUrl]
            : [],
        biographyRaw: detail?.bio ?? null,
        // Muttville is senior-dog-only; dogs live in foster homes around the Bay Area.
        fosterNotes: "Muttville dogs live in foster homes; meet by appointment via the rescue.",
        rawPayload: {
          card: card as unknown as Record<string, unknown>,
          facts: facts ? (facts as unknown as Record<string, unknown>) : null,
        },
        cardFingerprint,
        detailFetched: detail != null,
      });
    }

    const detailExtractionCompleted = !budgetExhausted && detailFailures === 0;

    return {
      dogs,
      totalReportedBySource: cards.length, // page lists all dogs; card count is the source's own total
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
