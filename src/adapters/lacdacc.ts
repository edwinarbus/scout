import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { hashObject, sha256 } from "@/lib/hash";
import { squish } from "./helpers";

/**
 * LA County Department of Animal Care & Control (custom_lac_dacc).
 *
 * The public search page (WordPress plugin "wppro-acc-search") calls a signed
 * JSON API. Flow per run:
 *   1. GET /dacc-search/ and scrape `accSearchVars` { signature, timestamp }.
 *   2. GET /wp-json/wppro-acc/v1/get/animals?AnimalType=DOG&PageNumber=N&
 *      PageSize=100&SortType=0&route=Animals with X-AccSearch-* headers.
 *   3. Signatures expire in minutes; on 403 refresh once and continue.
 *
 * The list API returns all core fields (name, id, sex, age, breed, care
 * center, kennel status, weight, color, size class, image count) plus
 * totalRecords for pagination auditing. The per-animal detail route needs a
 * different page signature and adds little, so v1 skips it; the human detail
 * URL is preserved on every dog.
 *
 * robots.txt sets Crawl-delay: 10 — the source config honors it (10s delay).
 */

export const LACDACC_PARSER_VERSION = "lacdacc-1.0.0";

const API_PATH = "/wp-json/wppro-acc/v1/get/animals";
const IMAGE_BASE = "https://daccanimalimagesprod.blob.core.windows.net/images/";
const PAGE_SIZE = 100;

/** Kennel status codes shown by the source UI (settings.json + observed). */
const KENNEL_STATUS_LABELS: Record<string, string> = {
  RTGH: "Ready to go home",
  "AV PEND SN": "Available - pending spay/neuter",
  "STRAY WAIT": "Stray wait (owner may reclaim)",
  "OTHER HOLD": "Other hold",
  "ID HOLD": "ID hold",
  "ADOPTION PENDING": "Adoption pending",
  "RESCUE ONLY": "Rescue only",
};

/**
 * Approximate coordinates for DACC care centers (map-display quality).
 * `location` values observed in the API: Agoura, Baldwin, Carson, Castaic,
 * Downey, Lancaster, Palmdale.
 */
const CARE_CENTERS: Record<
  string,
  { name: string; city: string; lat: number; lng: number }
> = {
  agoura: { name: "Agoura Animal Care Center", city: "Agoura Hills", lat: 34.1443, lng: -118.7462 },
  baldwin: { name: "Baldwin Park Animal Care Center", city: "Baldwin Park", lat: 34.0725, lng: -117.9855 },
  carson: { name: "Carson/Gardena Animal Care Center", city: "Gardena", lat: 33.8622, lng: -118.2837 },
  castaic: { name: "Castaic Animal Care Center", city: "Castaic", lat: 34.5083, lng: -118.6106 },
  downey: { name: "Downey Animal Care Center", city: "Downey", lat: 33.9245, lng: -118.1348 },
  lancaster: { name: "Lancaster Animal Care Center", city: "Lancaster", lat: 34.7204, lng: -118.1868 },
  palmdale: { name: "Palmdale Animal Care Center", city: "Palmdale", lat: 34.6183, lng: -118.0929 },
};

export interface DaccAnimal {
  animalId: string;
  animalName: string | null;
  sex: string | null;
  yearsOld: number | null;
  monthsOld: number | null;
  breed: string | null;
  location: string | null;
  kennelStat: string | null;
  kennelSubStat: string | null;
  rescueOnly: string | null;
  medicalStat: string | null;
  weight: number | null;
  outcomeType: string | null;
  primaryColor: string | null;
  animalType: string | null;
  animalSize: string | null;
  imageCount: number | null;
}

interface DaccPage {
  currentPage: number;
  startRecord: number;
  endRecord: number;
  totalPages: number;
  totalRecords: number;
  animals: DaccAnimal[];
  errorMessage?: string;
}

export function photoUrlsFor(animalId: string, imageCount: number | null): string[] {
  // imageCount is authoritative: 0 means the source has no photo for this
  // animal, and we must not fabricate one (it would just 404 downstream).
  // A missing/null count is treated as "assume at least one" — unlike an
  // explicit 0, that's not the source telling us there is nothing.
  const count = Math.min(imageCount ?? 1, 12);
  if (count < 1) return [];
  const urls = [`${IMAGE_BASE}${animalId}.jpg`];
  for (let i = 2; i <= count; i++) urls.push(`${IMAGE_BASE}${animalId}-${i}.jpg`);
  return urls;
}

export function mapDaccAnimal(a: DaccAnimal, baseUrl: string): ExtractedDog {
  const center = a.location ? CARE_CENTERS[a.location.trim().toLowerCase()] : undefined;
  const years = a.yearsOld ?? 0;
  const months = a.monthsOld ?? 0;
  const ageRaw =
    years || months ? squish(`${years ? `${years} years ` : ""}${months ? `${months} months` : ""}`) : null;
  const statusRaw = squish(a.kennelStat);
  const statusLabel = statusRaw ? (KENNEL_STATUS_LABELS[statusRaw.toUpperCase()] ?? null) : null;
  const holdBits = [
    statusLabel && /hold|wait|pending/i.test(statusLabel) ? statusLabel : null,
    squish(a.medicalStat) ? `Medical: ${squish(a.medicalStat)}` : null,
  ].filter(Boolean);
  const photos = photoUrlsFor(a.animalId, a.imageCount);

  return {
    sourceAnimalId: a.animalId,
    originalUrl: `${baseUrl}/dacc-details/?animalId=${encodeURIComponent(a.animalId)}`,
    name: squish(a.animalName),
    species: squish(a.animalType) ?? "DOG",
    breedRaw: squish(a.breed),
    ageRaw,
    sexRaw: squish(a.sex),
    sizeRaw: squish(a.animalSize),
    weightRaw: a.weight != null && a.weight > 0 ? `${a.weight} lbs` : null,
    colorRaw: squish(a.primaryColor),
    statusRaw: statusLabel ? `${statusRaw} (${statusLabel})` : statusRaw,
    shelterName: center?.name ?? (a.location ? `DACC - ${a.location}` : null),
    shelterLocationName: squish(a.location),
    city: center?.city ?? null,
    county: "Los Angeles",
    state: "CA",
    latitude: center?.lat ?? null,
    longitude: center?.lng ?? null,
    geocodePrecision: center ? "campus" : null,
    primaryPhotoUrl: photos[0] ?? null,
    photoUrls: photos,
    urgentNotes: squish(a.rescueOnly) ? "Rescue only" : null,
    holdNotes: holdBits.length ? holdBits.join(" | ") : null,
    rawPayload: { api: a as unknown as Record<string, unknown> },
    cardFingerprint: hashObject(a),
    detailFetched: false, // list API is the full record in v1
  };
}

async function fetchSignature(
  ctx: AdapterContext,
  pageUrl: string
): Promise<{ signature: string; timestamp: string; html: string }> {
  const res = await ctx.fetch(pageUrl);
  if (!res.ok) throw new Error(`search page HTTP ${res.status} (needed for API signature)`);
  const sig = res.text.match(/signature:\s*'([0-9a-f]+)'/)?.[1];
  const ts = res.text.match(/timestamp:\s*'(\d+)'/)?.[1];
  if (!sig || !ts) throw new Error("could not extract accSearchVars signature from search page");
  return { signature: sig, timestamp: ts, html: res.text };
}

export const lacdaccAdapter: SourceAdapter = {
  system: "custom_lac_dacc",
  parserVersion: LACDACC_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = (source.baseUrl ?? "https://animalcare.lacounty.gov").replace(/\/$/, "");
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];

    let auth = await fetchSignature(ctx, source.listingUrl);
    const htmlHash = sha256(auth.html);
    ctx.saveDebug("search-page.html", auth.html);
    let pagesVisited = 1; // the signature page counts as a visit

    const animals = new Map<string, DaccAnimal>();
    let total: number | null = null;
    let paginationCompleted = false;
    let refreshedSignature = false;

    for (let page = 1; page <= ctx.limits.maxPages; page++) {
      const apiUrl = `${base}${API_PATH}?AnimalType=DOG&PageNumber=${page}&PageSize=${PAGE_SIZE}&SortType=0&route=Animals`;
      let res = await ctx.fetch(apiUrl, {
        headers: {
          Accept: "application/json",
          "X-AccSearch-Signature": auth.signature,
          "X-AccSearch-Timestamp": auth.timestamp,
        },
      });
      pagesVisited++;
      if (res.status === 403 && !refreshedSignature) {
        // Signature expired mid-run: refresh once and retry this page.
        refreshedSignature = true;
        ctx.log("API signature expired; refreshing from search page");
        auth = await fetchSignature(ctx, source.listingUrl);
        pagesVisited++;
        res = await ctx.fetch(apiUrl, {
          headers: {
            Accept: "application/json",
            "X-AccSearch-Signature": auth.signature,
            "X-AccSearch-Timestamp": auth.timestamp,
          },
        });
        pagesVisited++;
      }
      if (!res.ok) {
        warnings.push(`animals API page ${page} returned HTTP ${res.status}`);
        trace.push({ url: apiUrl, page, resultCount: 0, note: `HTTP ${res.status}` });
        break;
      }
      let data: DaccPage;
      try {
        data = JSON.parse(res.text) as DaccPage;
      } catch {
        warnings.push(`animals API page ${page} returned non-JSON`);
        trace.push({ url: apiUrl, page, resultCount: 0, note: "non-JSON response" });
        break;
      }
      if (data.errorMessage) warnings.push(`API error message: ${data.errorMessage}`);
      if (page === 1) ctx.saveDebug("animals-page1.json", res.text);

      const batch = (data.animals ?? []).filter((a) => a && a.animalId);
      for (const a of batch) animals.set(a.animalId, a);
      total = data.totalRecords ?? total;
      trace.push({
        url: apiUrl,
        page,
        resultCount: batch.length,
        note: `records ${data.startRecord}-${data.endRecord} of ${data.totalRecords}`,
      });

      if (data.endRecord >= data.totalRecords || batch.length === 0) {
        paginationCompleted = true;
        break;
      }
      if (page === ctx.limits.maxPages) {
        warnings.push(
          `pagination stopped at maxPagesPerRun=${ctx.limits.maxPages}; source reports ${data.totalRecords} records`
        );
      }
    }

    if (total != null && animals.size < total && paginationCompleted) {
      // Records can shift between pages while we crawl; count mismatch is a
      // warning, not silent truncation.
      warnings.push(`extracted ${animals.size} unique dogs but source reported ${total}`);
    }

    const dogs: ExtractedDog[] = [];
    for (const a of animals.values()) {
      if (a.animalType && a.animalType.toUpperCase() !== "DOG") continue; // safety filter
      dogs.push(mapDaccAnimal(a, base));
    }

    return {
      dogs,
      totalReportedBySource: total,
      pagesVisited,
      detailPagesVisited: 0,
      detailsAttempted: 0,
      detailsSucceeded: 0,
      detailsFailed: 0,
      paginationCompleted,
      detailExtractionCompleted: true, // list API carries the full v1 record
      warnings,
      paginationTrace: trace,
      htmlHash,
    };
  },
};
