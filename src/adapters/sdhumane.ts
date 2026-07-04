import type { AdapterContext, SourceAdapter } from "./types";
import type { AdapterResult, ExtractedDog, TriState } from "@/lib/types";
import { squish } from "./helpers";
import { hashObject, sha256 } from "@/lib/hash";

/**
 * San Diego Humane Society — their available-pets widget calls a first-party
 * AWS API Gateway feed that returns EVERY currently-available animal (all
 * campuses, all species) in one GET; the page filters client-side. The feed
 * is ShelterBuddy-backed (sdhumane.shelterbuddy.com storage/API references).
 *
 * Human detail page: /adopt/available-pets/animal-single?petId={AnimalId}
 * Photos: https://sdhumane.shelterbuddy.com{MainPhoto.default[0]}
 *
 * The API URL below is the exact one embedded in sdhumane.org's own page
 * (discovered 2026-07-01); if their site changes it, re-scrape the page.
 */

export const SDHUMANE_PARSER_VERSION = "sdhumane-1.0.0";

export const SDHS_API_URL =
  "https://tje3xq7eu2.execute-api.us-west-1.amazonaws.com/production/search?" +
  [
    "AnimalType=ALL",
    "Location=El%20Cajon%20Campus",
    "Location=Escondido%20Campus",
    "Location=Oceanside%20Campus%20-%20Cats/Small%20Animals",
    "Location=Oceanside%20Campus%20-%20Dogs",
    "Location=San%20Diego%20Campus%20-%205500",
    "Location=San%20Diego%20Campus%20-%205485",
    "Location=San%20Diego%20Campus%20-%20Behavior%20Center",
    "Location=San%20Diego%20Campus%20-%205480",
    "Location=Nursery%20-%20San%20Diego",
    "Location=San%20Diego%20Campus%20-%205495",
    "Location=San%20Diego%20Campus%20-%205525",
    "StatusCategory=available",
  ].join("&");

const PHOTO_BASE = "https://sdhumane.shelterbuddy.com";

/** Approximate campus coordinates (map-display quality). */
const CAMPUSES: Array<{ match: RegExp; city: string; lat: number; lng: number }> = [
  { match: /el cajon/i, city: "El Cajon", lat: 32.7948, lng: -116.9625 },
  { match: /escondido/i, city: "Escondido", lat: 33.142, lng: -117.0405 },
  { match: /oceanside/i, city: "Oceanside", lat: 33.2211, lng: -117.3428 },
  { match: /san diego|nursery/i, city: "San Diego", lat: 32.7526, lng: -117.1998 },
];

export interface SdhsAnimal {
  AnimalId: number;
  AnimalType: string | null;
  Location: string | null;
  Intake_Source_Name: string | null;
  Status: string | null;
  SubStatus: string | null;
  SubStatuses_Primary?: string | null;
  SubStatuses_Secondary?: string | null;
  Icons_Primary?: string | null;
  Icons_Secondary?: string | null;
  Icons_Tertiary?: string | null;
  InFoster: boolean | null;
  Shelter: string | null;
  Suburb: string | null;
  Postcode: string | null;
  DateFound: string | null;
  Intake: string | null;
  StatusCategory: string | null;
  Name: string | null;
  Sex: string | null;
  Breed: { Primary: string | null; Secondary: string | null; IsCrossBreed: boolean } | null;
  Age: {
    Years: number | null;
    Months: number | null;
    Weeks: number | null;
    IsApproximate: boolean;
    AgeGroup: string | null;
  } | null;
  MainPhoto: { default?: string[] } | null;
  LastUpdatedUtc: string | null;
}

/** Icons are explicit shelter assertions — map only the unambiguous ones. */
export function iconsToFlags(icons: Array<string | null | undefined>): {
  goodWithKids: TriState;
  goodWithDogs: TriState;
  goodWithCats: TriState;
} {
  const all = icons.filter(Boolean).join(" | ").toLowerCase();
  const flag = (yes: RegExp, no?: RegExp): TriState =>
    yes.test(all) ? true : no && no.test(all) ? false : null;
  return {
    goodWithKids: flag(/done well with kids/),
    goodWithDogs: flag(/done well with dogs/, /only dog home|only pet home/),
    goodWithCats: flag(/done well with cats/),
  };
}

export function mapSdhsAnimal(a: SdhsAnimal, baseUrl: string): ExtractedDog {
  const campus = a.Location ? CAMPUSES.find((c) => c.match.test(a.Location!)) : undefined;
  const breeds = [a.Breed?.Primary, a.Breed?.Secondary].filter(Boolean).join(" / ");
  const breedRaw = breeds
    ? a.Breed?.IsCrossBreed && !a.Breed?.Secondary
      ? `${breeds} Mix`
      : breeds
    : null;
  const ageBits: string[] = [];
  if (a.Age?.Years) ageBits.push(`${a.Age.Years} years`);
  if (a.Age?.Months) ageBits.push(`${a.Age.Months} months`);
  if (!a.Age?.Years && !a.Age?.Months && a.Age?.Weeks) ageBits.push(`${a.Age.Weeks} weeks`);
  const ageRaw = ageBits.length
    ? `${ageBits.join(" ")}${a.Age?.IsApproximate ? " (approx)" : ""}`
    : (a.Age?.AgeGroup ?? null);
  const statusRaw = [a.Status, a.SubStatus].filter(Boolean).join(" — ");
  const photoPath = a.MainPhoto?.default?.[0] ?? null;
  const photoUrls = photoPath ? [`${PHOTO_BASE}${photoPath}`] : [];
  const flags = iconsToFlags([a.Icons_Primary, a.Icons_Secondary, a.Icons_Tertiary]);
  const intakeIso = a.Intake ? a.Intake.slice(0, 10) : null;

  return {
    sourceAnimalId: String(a.AnimalId),
    originalUrl: `${baseUrl}/adopt/available-pets/animal-single?petId=${a.AnimalId}`,
    name: squish(a.Name),
    species: squish(a.AnimalType),
    breedRaw,
    ageRaw,
    sexRaw: squish(a.Sex),
    sizeRaw: null, // feed carries no size/weight
    weightRaw: null,
    colorRaw: null, // feed carries no color
    statusRaw: statusRaw || squish(a.StatusCategory),
    intakeDateRaw: intakeIso,
    shelterName: a.Location ? `San Diego Humane Society - ${a.Location}` : null,
    shelterLocationName: squish(a.Location),
    city: campus?.city ?? squish(a.Suburb),
    county: "San Diego",
    state: "CA",
    postalCode: squish(a.Postcode),
    latitude: campus?.lat ?? null,
    longitude: campus?.lng ?? null,
    geocodePrecision: campus ? "campus" : null,
    primaryPhotoUrl: photoUrls[0] ?? null,
    photoUrls,
    fosterNotes: a.InFoster ? "Listed as in a foster home — meet via SDHS." : null,
    ...flags,
    rawPayload: { api: a as unknown as Record<string, unknown> },
    cardFingerprint: hashObject(a),
    detailFetched: false, // one-call feed carries the whole v1 record
  };
}

export const sdhumaneAdapter: SourceAdapter = {
  system: "shelterbuddy",
  parserVersion: SDHUMANE_PARSER_VERSION,

  async crawl(ctx: AdapterContext): Promise<AdapterResult> {
    const { source } = ctx;
    const base = (source.baseUrl ?? "https://sdhumane.org").replace(/\/$/, "");
    const warnings: string[] = [];

    const res = await ctx.fetch(SDHS_API_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`SDHS feed returned HTTP ${res.status}`);
    const htmlHash = sha256(res.text);
    let payload: { response?: SdhsAnimal[] };
    try {
      payload = JSON.parse(res.text);
    } catch {
      throw new Error("SDHS feed returned non-JSON");
    }
    const all = payload.response ?? [];
    ctx.saveDebug("search-response-meta.json", JSON.stringify({ total: all.length }));
    if (all.length === 0) warnings.push("feed returned zero animals — API may have changed");

    const seen = new Set<number>();
    const dogs: ExtractedDog[] = [];
    for (const a of all) {
      if (!a || a.AnimalType !== "Dog" || a.AnimalId == null) continue;
      if (seen.has(a.AnimalId)) {
        warnings.push(`duplicate AnimalId in feed: ${a.AnimalId}`);
        continue;
      }
      seen.add(a.AnimalId);
      dogs.push(mapSdhsAnimal(a, base));
    }
    ctx.log(`feed: ${all.length} animals total, ${dogs.length} dogs`);

    return {
      dogs,
      totalReportedBySource: dogs.length, // the feed IS the complete inventory
      pagesVisited: 1,
      detailPagesVisited: 0,
      detailsAttempted: 0,
      detailsSucceeded: 0,
      detailsFailed: 0,
      paginationCompleted: true, // single complete response, no pagination
      detailExtractionCompleted: true,
      warnings,
      paginationTrace: [
        {
          url: SDHS_API_URL,
          page: 1,
          resultCount: dogs.length,
          note: `single-call feed; ${all.length} animals all species`,
        },
      ],
      htmlHash,
    };
  },
};
