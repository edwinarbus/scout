import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, PageTraceEntry } from "@/lib/types";
import { squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";

/**
 * Adopets (vendor platform) — used by Long Beach Animal Care Services.
 *
 * The public iframe app authenticates anonymously and searches pets:
 *   1. POST {api}/auth/session-request { system_api_key, fingerprint, json }
 *      → data.access_key (Bearer token). The system_api_key is the public
 *      key embedded in Adopets' own iframe bundle — the same anonymous
 *      access any site visitor gets.
 *   2. POST {api}/pet/find { limit, organization_pet:{specie_uuid},
 *      shelter_uuid, origin_key:"IFRAME" } → { data: { result, pages, ... } }
 *      Follow-ups pass { tracker_uuid, offset } to page through results.
 *
 * Human pet page (originalUrl): https://adopt.adopets.com/pet/{uuid}
 * Config per source (shelter_uuid, specie_uuid) comes from the iframe URL on
 * the shelter's own site and lives in the source registry notes + adapter map.
 */

export const ADOPETS_PARSER_VERSION = "adopets-1.0.0";

const API = "https://service.api.prd.adopets.app/adopter";
const SYSTEM_API_KEY = "be02b406-ea8d-4939-ba35-bab4b50e6cbf"; // public, from Adopets' iframe bundle
const PET_PAGE_BASE = "https://adopt.adopets.com/pet/";
const PAGE_LIMIT = 12; // the iframe's own page size; larger limits are not honored reliably

/** Per-source Adopets tenant config, keyed by source id. */
export const ADOPETS_TENANTS: Record<
  string,
  { shelterUuid: string; dogSpecieUuid: string }
> = {
  long_beach_acs: {
    shelterUuid: "1d7b348f-6a48-4214-a032-253401913a3e",
    dogSpecieUuid: "7eeb0882-ee86-491c-bdd4-e619099b6fd8",
  },
  // Front Street / City of Sacramento Animal Care Services. The iframe also
  // carries a branch_uuid, but passing it doesn't change results, so we keep
  // the query shape identical to Long Beach. dogSpecieUuid is Adopets' global
  // "Dog" species uuid (same across tenants).
  front_street: {
    shelterUuid: "f7631c97-1c0d-4616-bbf9-1ae7953ccec8",
    dogSpecieUuid: "7eeb0882-ee86-491c-bdd4-e619099b6fd8",
  },
};

/** pet/find result items wrap the pet as { organization_pet: {...} }. */
export interface AdopetsFindItem {
  organization_pet?: AdopetsPet;
}

export interface AdopetsPet {
  uuid: string;
  code: string | null;
  name: string | null;
  status_key: string | null;
  breed_primary_name: string | null;
  breed_secondary_name: string | null;
  specie_name: string | null;
  mix: boolean | null;
  sex_key: string | null;
  age_key: string | null;
  age_number: number | null; // days
  size_key: string | null;
  size_number: string | null; // lbs
  price: string | null;
  picture: string | null;
  description: string | null;
  foster: boolean | null;
  kennel_number: string | null;
  microchip: string | null;
}

export function mapAdopetsPet(p: AdopetsPet): ExtractedDog {
  const breeds = [p.breed_primary_name, p.breed_secondary_name].filter(Boolean).join(" / ");
  const ageRaw =
    p.age_number != null && p.age_number > 0
      ? `${p.age_number} days${p.age_key ? ` (${p.age_key.toLowerCase()})` : ""}`
      : (p.age_key?.toLowerCase() ?? null);
  return {
    sourceAnimalId: squish(p.code) ?? p.uuid,
    originalUrl: `${PET_PAGE_BASE}${p.uuid}`,
    name: squish(p.name),
    species: squish(p.specie_name) ?? "Dog",
    breedRaw: breeds ? (p.mix ? `${breeds} Mix` : breeds) : null,
    ageRaw,
    sexRaw: squish(p.sex_key)?.toLowerCase() ?? null,
    sizeRaw: squish(p.size_key),
    weightRaw: p.size_number ? `${p.size_number} lbs` : null,
    colorRaw: null, // not exposed by the search API
    statusRaw: squish(p.status_key)?.toLowerCase() ?? null,
    primaryPhotoUrl: p.picture ?? null,
    photoUrls: p.picture ? [p.picture] : [],
    description: squish(p.description),
    adoptionFee: p.price ? `$${p.price}` : null,
    fosterNotes: p.foster ? "Listed as in foster care." : null,
    microchipped: p.microchip ? true : null,
    rawPayload: { api: p as unknown as Record<string, unknown> },
    cardFingerprint: hashObject(p),
    detailFetched: false, // search records are the full v1 record
  };
}

export const adopetsAdapter: SourceAdapter = {
  system: "adopets",
  parserVersion: ADOPETS_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const tenant = ADOPETS_TENANTS[source.id];
    if (!tenant) {
      throw new Error(
        `no Adopets tenant config for source "${source.id}" — add shelter/specie uuids to ADOPETS_TENANTS`
      );
    }
    const warnings: string[] = [];
    const trace: PageTraceEntry[] = [];

    // 1. anonymous session
    const sessRes = await ctx.fetch(`${API}/auth/session-request`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: {
        system_api_key: SYSTEM_API_KEY,
        fingerprint: "scoutpersonaladoptionsearch00000",
        json: { user_agent: "scout-personal-adoption-search" },
      },
    });
    if (!sessRes.ok) throw new Error(`Adopets session-request HTTP ${sessRes.status}`);
    const accessKey = JSON.parse(sessRes.text)?.data?.access_key as string | undefined;
    if (!accessKey) throw new Error("Adopets session-request returned no access_key");

    // 2. paged pet/find
    const petsByUuid = new Map<string, AdopetsPet>();
    let htmlHash: string | null = null;
    let pagesVisited = 1; // session request counts as a visit
    let paginationCompleted = false;
    let trackerUuid: string | null = null;
    let reportedPages: number | null = null;

    for (let page = 0; page < ctx.limits.maxPages; page++) {
      const body =
        page === 0
          ? {
              limit: PAGE_LIMIT,
              organization_pet: { specie_uuid: tenant.dogSpecieUuid },
              shelter_uuid: tenant.shelterUuid,
              origin_key: "IFRAME",
              user_interaction: false,
            }
          : {
              origin_key: "IFRAME",
              tracker_uuid: trackerUuid,
              offset: petsByUuid.size,
              user_interaction: false,
            };
      const res = await ctx.fetch(`${API}/pet/find`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessKey}` },
        body,
      });
      pagesVisited++;
      if (!res.ok) {
        warnings.push(`pet/find page ${page + 1} returned HTTP ${res.status}`);
        trace.push({ url: `${API}/pet/find`, page: page + 1, resultCount: 0, note: `HTTP ${res.status}` });
        break;
      }
      if (page === 0) {
        htmlHash = sha256(res.text);
        ctx.saveDebug("pet-find-page1.json", res.text);
      }
      let data: {
        data?: {
          result?: AdopetsFindItem[];
          pages?: number;
          total?: number;
          tracker_pet_find?: { uuid?: string };
        };
      };
      try {
        data = JSON.parse(res.text);
      } catch {
        warnings.push(`pet/find page ${page + 1} returned non-JSON`);
        break;
      }
      const batch = (data.data?.result ?? [])
        .map((item) => item?.organization_pet)
        .filter((p): p is AdopetsPet => !!p?.uuid);
      trackerUuid = data.data?.tracker_pet_find?.uuid ?? trackerUuid;
      reportedPages = data.data?.pages ?? reportedPages;
      const before = petsByUuid.size;
      for (const p of batch) {
        petsByUuid.set(p.uuid, p);
      }
      trace.push({
        url: `${API}/pet/find`,
        page: page + 1,
        resultCount: batch.length,
        note: `${petsByUuid.size - before} new; pages=${data.data?.pages}, total=${data.data?.total}`,
      });
      if (batch.length < PAGE_LIMIT || petsByUuid.size === before) {
        paginationCompleted = true;
        break;
      }
      if (page === ctx.limits.maxPages - 1) {
        warnings.push(`pagination stopped at maxPagesPerRun=${ctx.limits.maxPages} with a full page`);
      }
      if (page > 0 && !trackerUuid) {
        warnings.push("no tracker_uuid returned; cannot page further");
        break;
      }
    }

    const dogs: ExtractedDog[] = [];
    for (const p of petsByUuid.values()) {
      if (p.specie_name && p.specie_name.toLowerCase() !== "dog") continue; // specie filter is server-side; belt+suspenders
      dogs.push(mapAdopetsPet(p));
    }
    if (dogs.length === 0) warnings.push("zero dogs extracted from Adopets feed");

    return {
      dogs,
      totalReportedBySource:
        reportedPages != null && paginationCompleted ? dogs.length : null,
      pagesVisited,
      detailPagesVisited: 0,
      detailsAttempted: 0,
      detailsSucceeded: 0,
      detailsFailed: 0,
      paginationCompleted,
      detailExtractionCompleted: true,
      warnings,
      paginationTrace: trace,
      htmlHash,
    };
  },
};
