import type { AdoptionSourceRow, NewDogListingRow } from "@/db/schema";
import { contentHash, photoHash, sha256 } from "@/lib/hash";
import { resolveDogLocation } from "@/lib/geo";
import {
  normalizeBreed,
  normalizeColors,
  normalizeName,
  normalizeSex,
  normalizeSize,
  normalizeStatus,
  parseAgeToMonths,
  parseWeightLbs,
} from "@/lib/normalize";
import type { ExtractedDog } from "@/lib/types";

/**
 * Turn one adapter extraction into a normalized dog_listings row.
 * Raw values are preserved alongside every normalized value; lifecycle
 * fields (firstSeenAt etc.) are the runner's job, not ours.
 */

export function listingKeyFor(dog: ExtractedDog): string {
  return dog.sourceAnimalId?.trim() || `url_${sha256(dog.originalUrl).slice(0, 16)}`;
}

export function listingIdFor(sourceId: string, dog: ExtractedDog): string {
  return `${sourceId}::${listingKeyFor(dog)}`;
}

/**
 * Bookkeeping fields excluded from the content hash: their change does not
 * mean "the listing changed". rawPayload is excluded because sources embed
 * volatile text ("refreshed 39 minutes ago"); cardFingerprint tracks markup,
 * not meaning.
 */
const NON_CONTENT_FIELDS = new Set([
  "id",
  "contentHash",
  "photoHash",
  "cardFingerprint",
  "detailFetchedAt",
  "rawPayload",
  "canonicalDogId",
  "firstSeenAt",
  "lastSeenAt",
  "missingSince",
  "missedRunCount",
  "staleStatus",
  "createdAt",
  "updatedAt",
  "lastChangedAt",
  "dedupeKey",
  "dedupeMethod",
  "possibleDuplicateOf",
  "duplicateConfidence",
]);

/** The fields whose change means "this listing changed" (content hash inputs). */
export function contentFieldsOf(row: Record<string, unknown>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!NON_CONTENT_FIELDS.has(k) && v !== undefined) content[k] = v;
  }
  return content;
}

/** Recompute the content hash for a (possibly merged) row. */
export function recomputeContentHash(row: Record<string, unknown>): string {
  return contentHash(contentFieldsOf(row));
}

export function normalizeExtracted(
  source: AdoptionSourceRow,
  dog: ExtractedDog,
  now: Date
): NewDogListingRow {
  const name = normalizeName(dog.name);
  const breed = normalizeBreed(dog.breedRaw);
  const age = parseAgeToMonths(dog.ageRaw, now);
  const sexInfo = normalizeSex(dog.sexRaw);
  const weightLbs = parseWeightLbs(dog.weightRaw);
  const size = normalizeSize(dog.sizeRaw, weightLbs);
  const colors = normalizeColors(dog.colorRaw);
  const status = normalizeStatus(dog.statusRaw);
  const location = resolveDogLocation(
    {
      latitude: dog.latitude ?? null,
      longitude: dog.longitude ?? null,
      geocodePrecision: dog.geocodePrecision ?? null,
      city: dog.city ?? null,
      county: dog.county ?? null,
    },
    {
      latitude: source.latitude,
      longitude: source.longitude,
      geocodePrecision: source.geocodePrecision,
      city: source.city,
      county: source.county,
    }
  );

  const photoUrls = [...new Set(dog.photoUrls.filter(Boolean))].slice(0, 24);
  const primaryPhotoUrl = dog.primaryPhotoUrl ?? photoUrls[0] ?? null;

  const contentPart = {
    sourceId: source.id,
    sourceSystem: source.sourceSystem,
    sourceAnimalId: dog.sourceAnimalId ?? null,
    listingKey: listingKeyFor(dog),
    originalUrl: dog.originalUrl,
    name,
    species: dog.species ?? null,
    breedRaw: dog.breedRaw ?? null,
    breedNormalized: breed.normalized,
    ageRaw: dog.ageRaw ?? null,
    ageMonthsEstimate: age.months,
    sex: sexInfo.sex,
    sizeRaw: dog.sizeRaw ?? null,
    sizeNormalized: size,
    weightRaw: dog.weightRaw ?? null,
    weightLbsEstimate: weightLbs,
    colorRaw: dog.colorRaw ?? null,
    colorsNormalized: colors,
    statusRaw: dog.statusRaw ?? null,
    statusNormalized: status,
    availabilityDate: dog.availabilityDateRaw ?? null,
    intakeDate: dog.intakeDateRaw ?? null,
    shelterName: dog.shelterName ?? source.name,
    shelterLocationName: dog.shelterLocationName ?? null,
    address: dog.address ?? null,
    city: dog.city ?? null,
    county: dog.county ?? source.county,
    state: dog.state ?? source.state ?? "CA",
    postalCode: dog.postalCode ?? null,
    latitude: location.latitude,
    longitude: location.longitude,
    geocodePrecision: location.precision,
    primaryPhotoUrl,
    photoUrls,
    description: dog.description ?? null,
    biographyRaw: dog.biographyRaw ?? null,
    goodWithDogs: dog.goodWithDogs ?? null,
    goodWithCats: dog.goodWithCats ?? null,
    goodWithKids: dog.goodWithKids ?? null,
    houseTrained: dog.houseTrained ?? null,
    apartmentFriendly: dog.apartmentFriendly ?? null,
    energyLevel: dog.energyLevel ?? null,
    specialNeeds: dog.specialNeeds ?? null,
    spayedNeutered: dog.spayedNeutered ?? sexInfo.spayedNeutered,
    vaccinated: dog.vaccinated ?? null,
    microchipped: dog.microchipped ?? null,
    adoptionFee: dog.adoptionFee ?? null,
    urgentNotes: dog.urgentNotes ?? null,
    fosterNotes: dog.fosterNotes ?? null,
    holdNotes: dog.holdNotes ?? null,
    contactPhone: dog.contactPhone ?? null,
    contactEmail: dog.contactEmail ?? null,
    contactUrlOverride: dog.contactUrlOverride ?? null,
  };

  const hasAnimalId = !!dog.sourceAnimalId?.trim();
  const row: NewDogListingRow = {
    id: listingIdFor(source.id, dog),
    ...contentPart,
    photoHash: photoHash(photoUrls),
    cardFingerprint: dog.cardFingerprint ?? null,
    detailFetchedAt: dog.detailFetched ? now : null,
    rawPayload: dog.rawPayload,
    contentHash: "",
    // Dedupe audit: strongest available key wins.
    dedupeKey: listingKeyFor(dog),
    dedupeMethod: hasAnimalId ? "source_animal_id" : "original_url",
    possibleDuplicateOf: null,
    duplicateConfidence: null,
    lastChangedAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    missingSince: null,
    missedRunCount: 0,
    staleStatus: "available",
    createdAt: now,
    updatedAt: now,
  };
  row.contentHash = recomputeContentHash(row as Record<string, unknown>);
  return row;
}

/**
 * Fields that may come only from detail pages (varies by adapter). When an
 * adapter returns a card-only extraction (detail skipped or budget
 * exhausted), no-information incoming values must not clobber previously
 * captured detail data. "No information" = null, empty array, or the
 * "unknown" sentinel (sex/status normalize to "unknown" when raw is absent).
 */
export const DETAIL_PRESERVED_FIELDS = [
  "description",
  "biographyRaw",
  "breedRaw",
  "breedNormalized",
  "ageRaw",
  "ageMonthsEstimate",
  "sex",
  "sizeRaw",
  "sizeNormalized",
  "weightRaw",
  "weightLbsEstimate",
  "colorRaw",
  "colorsNormalized",
  "statusRaw",
  "statusNormalized",
  "intakeDate",
  "availabilityDate",
  "shelterLocationName",
  "goodWithDogs",
  "goodWithCats",
  "goodWithKids",
  "houseTrained",
  "apartmentFriendly",
  "energyLevel",
  "specialNeeds",
  "spayedNeutered",
  "vaccinated",
  "microchipped",
  "adoptionFee",
  "urgentNotes",
  "fosterNotes",
  "holdNotes",
  "contactPhone",
  "contactEmail",
  "contactUrlOverride",
  "address",
  "postalCode",
] as const;

/** Does this incoming value carry real information, or is it a no-info sentinel? */
export function carriesInformation(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (value === "unknown") return false;
  return true;
}
