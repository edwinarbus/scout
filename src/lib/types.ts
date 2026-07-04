/**
 * Shared domain types for Scout.
 *
 * Scout is a personal, non-commercial California dog adoption scout.
 * Original shelter listings are always the source of truth; normalized
 * values never replace raw values, they sit alongside them.
 */

export const SOURCE_SYSTEMS = [
  "24petconnect",
  "shelterbuddy",
  "adopets",
  "shelterluv",
  "custom_laas",
  "custom_lac_dacc",
  "direct_html",
  "direct_js",
  "mock",
  "unknown",
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const GEOCODE_PRECISIONS = [
  "exact_shelter",
  "campus",
  "city",
  "county",
  "unknown",
] as const;
export type GeocodePrecision = (typeof GEOCODE_PRECISIONS)[number];

/** Normalized availability status. Raw source status is always preserved separately. */
export const NORMALIZED_STATUSES = [
  "available",
  "pending",
  "hold",
  "stray_hold",
  "rescue_only",
  "medical_hold",
  "foster",
  "adopted",
  "not_available",
  "unknown",
] as const;
export type StatusNormalized = (typeof NORMALIZED_STATUSES)[number];

/**
 * Cautious stale-listing lifecycle. A dog is never marked unavailable after a
 * single missing run, and never updated at all after a failed/partial run.
 */
export const STALE_STATUSES = [
  "available",
  "still_seen",
  "missing_once",
  "missing_multiple_runs",
  "likely_unavailable",
  "source_failed_do_not_update",
  "unknown",
] as const;
export type StaleStatus = (typeof STALE_STATUSES)[number];

export type SizeNormalized = "small" | "medium" | "large" | "xlarge";
export type Sex = "male" | "female" | "unknown";
export type AgeBucket = "puppy" | "young" | "adult" | "senior";
export type RunStatus =
  | "success"
  | "success_with_warnings"
  | "partial"
  | "failed"
  | "blocked";
export type BackfillStatus =
  | "never"
  | "success"
  | "success_with_warnings"
  | "partial"
  | "failed"
  | "blocked";
export type DedupeMethod = "source_animal_id" | "original_url" | "weak_fields";

export const USER_DOG_STATUSES = [
  "saved",
  "hidden",
  "contacted",
  "not_a_fit",
  "maybe",
  "adopted_elsewhere",
] as const;
export type UserDogStatus = (typeof USER_DOG_STATUSES)[number];

/** true / false / unknown. Never guess: absence of info is null. */
export type TriState = boolean | null;

/**
 * What an adapter emits for one dog. Everything here is as-extracted;
 * normalization happens centrally in the runner so all sources are
 * normalized identically. Missing/uncertain values MUST be null.
 */
export interface ExtractedDog {
  /** The source's own animal id (e.g. "A332073"). Null only if the source truly has none. */
  sourceAnimalId: string | null;
  /** Link back to the original listing. Required — original listings are the source of truth. */
  originalUrl: string;
  name: string | null;
  /** Raw species text. Adapters should already filter to dogs where possible. */
  species: string | null;
  breedRaw: string | null;
  ageRaw: string | null;
  /** ISO date string if the source provides an explicit DOB. */
  dateOfBirth?: string | null;
  sexRaw: string | null;
  sizeRaw: string | null;
  weightRaw: string | null;
  colorRaw: string | null;
  statusRaw: string | null;
  availabilityDateRaw?: string | null;
  intakeDateRaw?: string | null;
  /** Shelter/campus this dog is physically located at, as reported by the source. */
  shelterName?: string | null;
  shelterLocationName?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocodePrecision?: GeocodePrecision | null;
  primaryPhotoUrl: string | null;
  photoUrls: string[];
  description?: string | null;
  biographyRaw?: string | null;
  goodWithDogs?: TriState;
  goodWithCats?: TriState;
  goodWithKids?: TriState;
  houseTrained?: TriState;
  apartmentFriendly?: TriState;
  energyLevel?: string | null;
  specialNeeds?: string | null;
  spayedNeutered?: TriState;
  vaccinated?: TriState;
  microchipped?: TriState;
  adoptionFee?: string | null;
  urgentNotes?: string | null;
  fosterNotes?: string | null;
  holdNotes?: string | null;
  /** Dog-specific contact overrides. Shelter-level contact info lives on the AdoptionSource. */
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactUrlOverride?: string | null;
  /** Adapter-specific raw data preserved verbatim for debugging/reparsing. */
  rawPayload: Record<string, unknown>;
  /**
   * Hash of the card-level (listing page) data. Used to skip re-fetching detail
   * pages for dogs whose cards haven't changed — a politeness optimization.
   */
  cardFingerprint?: string | null;
  /** Whether the detail page was fetched this run (false = card-only extraction). */
  detailFetched?: boolean;
}

export interface PageTraceEntry {
  url: string;
  page: number;
  resultCount: number;
  note?: string;
}

/** What an adapter returns for one full source crawl. */
export interface AdapterResult {
  dogs: ExtractedDog[];
  /** Total listing count the source itself reports, if it reports one. */
  totalReportedBySource: number | null;
  pagesVisited: number;
  detailPagesVisited: number;
  /** Detail-page attempt accounting (attempted excludes fingerprint-skips). */
  detailsAttempted: number;
  detailsSucceeded: number;
  detailsFailed: number;
  paginationCompleted: boolean;
  detailExtractionCompleted: boolean;
  warnings: string[];
  paginationTrace: PageTraceEntry[];
  /** Hash of the first listing page, for structural drift detection across runs. */
  htmlHash: string | null;
}
