import { desc } from "drizzle-orm";
import type { ScoutDb } from "@/db";
import {
  adoptionSources,
  dogAiEnrichment,
  dogListings,
  savedSearches,
  sourceRuns,
  userDogStatuses,
  type DogListingRow,
} from "@/db/schema";
import { freshnessLabel } from "./lifecycle";
import { matchListing, type SearchCriteria } from "./match";
import { ageBucketFromMonths, parseLooseDate } from "./normalize";
import type {
  AgeBucket,
  GeocodePrecision,
  RunStatus,
  SizeNormalized,
  StaleStatus,
  StatusNormalized,
  UserDogStatus,
} from "./types";

/**
 * DogView is the UI-facing shape: one entry per canonical dog (duplicates
 * collapsed, per the over-dedupe policy), with source attribution, inherited
 * contact info, freshness, user status, and saved-search matches resolved.
 */

export interface DogViewSource {
  id: string;
  name: string;
  system: string;
  websiteUrl: string | null;
  region: string | null;
  lastRunStatus: RunStatus | null;
  lastRunAt: string | null;
  lastRunWarnings: number;
  lastRunMissingUpdatesApplied: boolean | null;
  lastRunConfidence: number | null;
  initializedForDailyMonitoring: boolean;
  backfillStatus: string;
}

export interface DogViewDuplicate {
  id: string;
  sourceId: string;
  sourceName: string;
  originalUrl: string;
}

export interface DogView {
  id: string;
  canonicalDogId: number | null;
  name: string | null;
  breedRaw: string | null;
  breedNormalized: string | null;
  ageRaw: string | null;
  ageMonthsEstimate: number | null;
  ageBucket: AgeBucket | null;
  sex: string | null;
  sizeRaw: string | null;
  sizeNormalized: SizeNormalized | null;
  weightRaw: string | null;
  weightLbsEstimate: number | null;
  colorsNormalized: string[];
  colorRaw: string | null;
  statusRaw: string | null;
  statusNormalized: StatusNormalized;
  staleStatus: StaleStatus;
  freshness: "fresh" | "stale" | "missing" | "uncertain";
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: GeocodePrecision;
  city: string | null;
  county: string | null;
  shelterName: string | null;
  shelterLocationName: string | null;
  primaryPhotoUrl: string | null;
  photoUrls: string[];
  description: string | null;
  biographyRaw: string | null;
  originalUrl: string;
  sourceAnimalId: string | null;
  intakeDate: string | null;
  availabilityDate: string | null;
  /** Length of stay in days since intake, when the source reports an intake date. */
  daysInShelter: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince: string | null;
  isNew: boolean;
  goodWithDogs: boolean | null;
  goodWithCats: boolean | null;
  goodWithKids: boolean | null;
  houseTrained: boolean | null;
  apartmentFriendly: boolean | null;
  energyLevel: string | null;
  specialNeeds: string | null;
  spayedNeutered: boolean | null;
  vaccinated: boolean | null;
  microchipped: boolean | null;
  adoptionFee: string | null;
  urgentNotes: string | null;
  fosterNotes: string | null;
  holdNotes: string | null;
  /** Contact info: dog-level overrides win, otherwise inherited from the source. */
  contact: {
    phone: string | null;
    email: string | null;
    contactUrl: string | null;
    adoptionProcessUrl: string | null;
    adoptionApplicationUrl: string | null;
    phoneIsOverride: boolean;
    emailIsOverride: boolean;
  };
  userStatus: UserDogStatus | null;
  matchedSearches: string[];
  source: DogViewSource;
  duplicates: DogViewDuplicate[];
  /** Dedupe transparency: how this listing is keyed and whether it may duplicate another. */
  dedupeMethod: string | null;
  weakDedupeKey: boolean;
  possibleDuplicate: boolean;
  /**
   * Claude vision read of the primary photo. MODEL INFERENCE from one image,
   * not a shelter fact — the UI labels it as such. Null when not enriched.
   */
  ai: DogViewAi | null;
}

export interface DogViewAi {
  coatLength: string | null;
  coatTexture: string | null;
  apparentSize: string | null;
  apparentColors: string[];
  tags: string[];
  visualDescription: string | null;
  photoQuality: string | null;
  confidence: number | null;
  model: string;
  analyzedAt: string;
}

/** A dog is flagged "new" only if the shelter's own intake date is on/after
 * this cutoff — a genuine just-arrived signal, not "recently scraped". Parsed
 * loosely because intake dates arrive in mixed formats (ISO from most sources,
 * MM/DD/YYYY from Oakland), so a raw string compare would be wrong. */
const NEW_INTAKE_CUTOFF = parseLooseDate("2026-07-02")!.getTime();

/** Whole days between an ISO date (yyyy-mm-dd) and now; null if no/invalid date. */
function daysSince(rawDate: string | null, now: Date): number | null {
  const d = parseLooseDate(rawDate); // handles ISO and MM/DD/YYYY
  if (!d) return null;
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  // Guard against clock skew / future intake dates.
  return days >= 0 ? days : null;
}

/** Priority when a canonical group's members disagree on user status. */
const USER_STATUS_PRIORITY: UserDogStatus[] = [
  "contacted",
  "saved",
  "maybe",
  "adopted_elsewhere",
  "not_a_fit",
  "hidden",
];

export function buildDogViews(db: ScoutDb, now: Date = new Date()): DogView[] {
  const listings = db.select().from(dogListings).all();
  const sources = db.select().from(adoptionSources).all();
  const statuses = db.select().from(userDogStatuses).all();
  const searches = db.select().from(savedSearches).all();
  const runs = db.select().from(sourceRuns).orderBy(desc(sourceRuns.startedAt)).all();
  const enrichment = db.select().from(dogAiEnrichment).all();
  const aiByListing = new Map(enrichment.map((e) => [e.dogListingId, e]));

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const statusById = new Map(statuses.map((s) => [s.dogListingId, s.status]));
  const lastRunBySource = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    if (!lastRunBySource.has(r.sourceId)) lastRunBySource.set(r.sourceId, r);
  }

  // Collapse canonical groups → one display listing each.
  const byCanonical = new Map<string, DogListingRow[]>();
  for (const l of listings) {
    const key = l.canonicalDogId != null ? `c${l.canonicalDogId}` : `solo:${l.id}`;
    const arr = byCanonical.get(key) ?? [];
    arr.push(l);
    byCanonical.set(key, arr);
  }

  const views: DogView[] = [];
  for (const group of byCanonical.values()) {
    const sorted = [...group].sort((a, b) => {
      const aActive = a.staleStatus === "available" || a.staleStatus === "still_seen" ? 0 : 1;
      const bActive = b.staleStatus === "available" || b.staleStatus === "still_seen" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aPhoto = (a.photoUrls?.length ?? 0) > 0 ? 0 : 1;
      const bPhoto = (b.photoUrls?.length ?? 0) > 0 ? 0 : 1;
      if (aPhoto !== bPhoto) return aPhoto - bPhoto;
      return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
    });
    const display = sorted[0];
    const source = sourceById.get(display.sourceId);
    if (!source) continue;
    // A dog is only worth showing if it has a photo — the whole experience
    // (cards, orbit, matcher) is visual. Photoless listings are dropped from
    // every view (the DB/ingestion still keeps them untouched).
    if (!display.primaryPhotoUrl) continue;
    const lastRun = lastRunBySource.get(display.sourceId) ?? null;

    const groupStatuses = group
      .map((l) => statusById.get(l.id))
      .filter((s): s is UserDogStatus => !!s);
    const userStatus =
      statusById.get(display.id) ??
      USER_STATUS_PRIORITY.find((p) => groupStatuses.includes(p)) ??
      null;

    const matchedSearches: string[] = [];
    for (const s of searches) {
      if (!s.enabled) continue;
      const result = matchListing(
        {
          breedNormalized: display.breedNormalized,
          breedRaw: display.breedRaw,
          ageMonthsEstimate: display.ageMonthsEstimate,
          ageRaw: display.ageRaw,
          sizeNormalized: (display.sizeNormalized as SizeNormalized) ?? null,
          weightLbsEstimate: display.weightLbsEstimate,
          colorsNormalized: display.colorsNormalized ?? [],
          statusNormalized: display.statusNormalized,
          sex: display.sex,
          latitude: display.latitude,
          longitude: display.longitude,
        },
        s.criteria as SearchCriteria
      );
      // "Strong match" = every evaluable criterion passed and at least one
      // positive reason exists (not just an absence of failures).
      if (result.matched && result.reasons.length > 0) matchedSearches.push(s.name);
    }

    views.push({
      id: display.id,
      canonicalDogId: display.canonicalDogId,
      name: display.name,
      breedRaw: display.breedRaw,
      breedNormalized: display.breedNormalized,
      ageRaw: display.ageRaw,
      ageMonthsEstimate: display.ageMonthsEstimate,
      ageBucket: ageBucketFromMonths(display.ageMonthsEstimate),
      sex: display.sex,
      sizeRaw: display.sizeRaw,
      sizeNormalized: (display.sizeNormalized as SizeNormalized) ?? null,
      weightRaw: display.weightRaw,
      weightLbsEstimate: display.weightLbsEstimate,
      colorsNormalized: display.colorsNormalized ?? [],
      colorRaw: display.colorRaw,
      statusRaw: display.statusRaw,
      statusNormalized: display.statusNormalized,
      staleStatus: display.staleStatus,
      freshness: freshnessLabel(display.staleStatus),
      latitude: display.latitude,
      longitude: display.longitude,
      geocodePrecision: display.geocodePrecision,
      city: display.city ?? source.city,
      county: display.county ?? source.county,
      shelterName: display.shelterName ?? source.name,
      shelterLocationName: display.shelterLocationName,
      primaryPhotoUrl: display.primaryPhotoUrl,
      photoUrls: display.photoUrls ?? [],
      description: display.description,
      biographyRaw: display.biographyRaw,
      originalUrl: display.originalUrl,
      sourceAnimalId: display.sourceAnimalId,
      intakeDate: display.intakeDate,
      availabilityDate: display.availabilityDate,
      daysInShelter: daysSince(display.intakeDate, now),
      firstSeenAt: display.firstSeenAt.toISOString(),
      lastSeenAt: display.lastSeenAt.toISOString(),
      missingSince: display.missingSince?.toISOString() ?? null,
      isNew: (parseLooseDate(display.intakeDate)?.getTime() ?? -Infinity) >= NEW_INTAKE_CUTOFF,
      goodWithDogs: display.goodWithDogs,
      goodWithCats: display.goodWithCats,
      goodWithKids: display.goodWithKids,
      houseTrained: display.houseTrained,
      apartmentFriendly: display.apartmentFriendly,
      energyLevel: display.energyLevel,
      specialNeeds: display.specialNeeds,
      spayedNeutered: display.spayedNeutered,
      vaccinated: display.vaccinated,
      microchipped: display.microchipped,
      adoptionFee: display.adoptionFee,
      urgentNotes: display.urgentNotes,
      fosterNotes: display.fosterNotes,
      holdNotes: display.holdNotes,
      contact: {
        phone: display.contactPhone ?? source.phone,
        email: display.contactEmail ?? source.email,
        contactUrl: display.contactUrlOverride ?? source.contactUrl ?? source.websiteUrl,
        adoptionProcessUrl: source.adoptionProcessUrl,
        adoptionApplicationUrl: source.adoptionApplicationUrl,
        phoneIsOverride: display.contactPhone != null,
        emailIsOverride: display.contactEmail != null,
      },
      userStatus,
      matchedSearches,
      source: {
        id: source.id,
        name: source.name,
        system: source.sourceSystem,
        websiteUrl: source.websiteUrl,
        region: source.region,
        lastRunStatus: (lastRun?.status as RunStatus) ?? null,
        lastRunAt: lastRun?.startedAt.toISOString() ?? null,
        lastRunWarnings: lastRun?.warnings?.length ?? 0,
        lastRunMissingUpdatesApplied: lastRun?.missingUpdatesApplied ?? null,
        lastRunConfidence: lastRun?.confidenceScore ?? null,
        initializedForDailyMonitoring: source.initializedForDailyMonitoring,
        backfillStatus: source.backfillStatus,
      },
      duplicates: sorted.slice(1).map((l) => ({
        id: l.id,
        sourceId: l.sourceId,
        sourceName: sourceById.get(l.sourceId)?.name ?? l.sourceId,
        originalUrl: l.originalUrl,
      })),
      dedupeMethod: display.dedupeMethod,
      weakDedupeKey: display.dedupeMethod !== "source_animal_id",
      possibleDuplicate: sorted.length > 1 || display.possibleDuplicateOf != null,
      ai: (() => {
        const e = aiByListing.get(display.id);
        if (!e) return null;
        return {
          coatLength: e.coatLength,
          coatTexture: e.coatTexture,
          apparentSize: e.apparentSize,
          apparentColors: e.apparentColors ?? [],
          tags: e.tags ?? [],
          visualDescription: e.visualDescription,
          photoQuality: e.photoQuality,
          confidence: e.confidence,
          model: e.model,
          analyzedAt: e.analyzedAt.toISOString(),
        };
      })(),
    });
  }

  // Newest first, fresh before stale.
  views.sort((a, b) => {
    const af = a.freshness === "fresh" ? 0 : 1;
    const bf = b.freshness === "fresh" ? 0 : 1;
    if (af !== bf) return af - bf;
    return b.firstSeenAt.localeCompare(a.firstSeenAt);
  });
  return views;
}
