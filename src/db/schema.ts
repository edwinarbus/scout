import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import type {
  GeocodePrecision,
  PageTraceEntry,
  SizeNormalized,
  SourceSystem,
  StaleStatus,
  StatusNormalized,
  UserDogStatus,
} from "@/lib/types";

/**
 * A place we collect listings from (shelter, rescue, or a vendor page for one).
 * Shelter-level contact info lives here; dog listings inherit it unless the
 * dog's own page provides an override.
 */
export const adoptionSources = sqliteTable("adoption_sources", {
  /** Stable slug, e.g. "24pc_santa_cruz". */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceSystem: text("source_system").$type<SourceSystem>().notNull(),
  listingUrl: text("listing_url").notNull(),
  baseUrl: text("base_url"),
  region: text("region"),
  city: text("city"),
  county: text("county"),
  state: text("state").notNull().default("CA"),
  postalCode: text("postal_code"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  geocodePrecision: text("geocode_precision")
    .$type<GeocodePrecision>()
    .notNull()
    .default("unknown"),

  // Contact info (inherited by dog cards unless a dog page overrides it)
  phone: text("phone"),
  email: text("email"),
  websiteUrl: text("website_url"),
  contactUrl: text("contact_url"),
  adoptionProcessUrl: text("adoption_process_url"),
  adoptionApplicationUrl: text("adoption_application_url"),
  hoursUrl: text("hours_url"),

  // Operational status
  priority: text("priority").notNull().default("medium"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  crawlIntervalHours: integer("crawl_interval_hours").notNull().default(24),

  // Permission / robots review. Operational notes only, never legal conclusions.
  permissionStatus: text("permission_status").notNull().default("unreviewed"),
  robotsStatus: text("robots_status").notNull().default("unchecked"),
  robotsCheckedAt: integer("robots_checked_at", { mode: "timestamp_ms" }),
  sourceStatusNotes: text("source_status_notes"),
  safeForPersonalLowFrequencyFetching: integer(
    "safe_for_personal_low_frequency_fetching",
    { mode: "boolean" }
  ),
  blocksAutomation: integer("blocks_automation", { mode: "boolean" }),
  notes: text("notes"),

  // Adapter configuration
  adapterType: text("adapter_type").notNull(),
  needsJavaScript: integer("needs_javascript", { mode: "boolean" })
    .notNull()
    .default(false),
  hasPagination: integer("has_pagination", { mode: "boolean" }),
  requiresDetailPages: integer("requires_detail_pages", { mode: "boolean" }),
  parserVersion: text("parser_version"),

  // Request politeness controls
  requestDelayMs: integer("request_delay_ms").notNull().default(1500),
  timeoutMs: integer("timeout_ms").notNull().default(25000),
  retryCount: integer("retry_count").notNull().default(2),
  maxPagesPerRun: integer("max_pages_per_run").notNull().default(40),
  maxDetailPagesPerRun: integer("max_detail_pages_per_run").notNull().default(200),
  /**
   * Send browser-profile headers instead of the Scout UA. Only set for
   * sources whose CDN blocks all non-browser clients (e.g. LAAS/Akamai) and
   * only as a documented operator decision — noted in `notes`.
   */
  useBrowserHeaders: integer("use_browser_headers", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * When set, a robots.txt disallow on the listing path does NOT auto-disable
   * the source; the reason documents why the operator chose to proceed
   * (e.g. LAAS ships Drupal's unmodified stock template whose /search/
   * disallow targets the core search module). Runs still record the robots
   * status and carry a warning.
   */
  robotsOverrideReason: text("robots_override_reason"),

  // Backfill / initialization state. Daily monitoring is not trusted until a
  // source has completed a successful (or acceptable) full-inventory backfill.
  backfillStatus: text("backfill_status")
    .$type<
      "never" | "success" | "success_with_warnings" | "partial" | "failed" | "blocked"
    >()
    .notNull()
    .default("never"),
  lastBackfillStartedAt: integer("last_backfill_started_at", { mode: "timestamp_ms" }),
  lastBackfillCompletedAt: integer("last_backfill_completed_at", { mode: "timestamp_ms" }),
  backfillListingsReported: integer("backfill_listings_reported"),
  backfillRawListingsExtracted: integer("backfill_raw_listings_extracted"),
  backfillDuplicateListingsDetected: integer("backfill_duplicate_listings_detected"),
  backfillUniqueListingsSaved: integer("backfill_unique_listings_saved"),
  backfillPaginationCompleted: integer("backfill_pagination_completed", { mode: "boolean" }),
  backfillDetailExtractionCompleted: integer("backfill_detail_extraction_completed", {
    mode: "boolean",
  }),
  backfillWarnings: text("backfill_warnings", { mode: "json" }).$type<string[]>(),
  initializedForDailyMonitoring: integer("initialized_for_daily_monitoring", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  /** Exact next debugging step for partial/blocked/needs_review sources. */
  nextDebugStep: text("next_debug_step"),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * One dog listing as seen at one source. The natural key is
 * (sourceId, listingKey) where listingKey is the source animal id, or a
 * URL-derived hash if the source has no ids. Cross-source duplicates are
 * grouped via canonicalDogId (see canonicalDogs).
 */
export const dogListings = sqliteTable(
  "dog_listings",
  {
    /** `${sourceId}::${listingKey}` — deterministic, stable across runs. */
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => adoptionSources.id),
    sourceSystem: text("source_system").$type<SourceSystem>().notNull(),
    sourceAnimalId: text("source_animal_id"),
    /** sourceAnimalId when available, otherwise a hash of originalUrl. */
    listingKey: text("listing_key").notNull(),
    originalUrl: text("original_url").notNull(),

    name: text("name"),
    species: text("species"),
    breedRaw: text("breed_raw"),
    breedNormalized: text("breed_normalized"),
    ageRaw: text("age_raw"),
    ageMonthsEstimate: integer("age_months_estimate"),
    sex: text("sex"),
    sizeRaw: text("size_raw"),
    sizeNormalized: text("size_normalized").$type<SizeNormalized | null>(),
    weightRaw: text("weight_raw"),
    weightLbsEstimate: real("weight_lbs_estimate"),
    colorRaw: text("color_raw"),
    colorsNormalized: text("colors_normalized", { mode: "json" }).$type<string[]>(),
    statusRaw: text("status_raw"),
    statusNormalized: text("status_normalized")
      .$type<StatusNormalized>()
      .notNull()
      .default("unknown"),
    availabilityDate: text("availability_date"),
    intakeDate: text("intake_date"),

    shelterName: text("shelter_name"),
    shelterLocationName: text("shelter_location_name"),
    address: text("address"),
    city: text("city"),
    county: text("county"),
    state: text("state"),
    postalCode: text("postal_code"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    geocodePrecision: text("geocode_precision")
      .$type<GeocodePrecision>()
      .notNull()
      .default("unknown"),

    primaryPhotoUrl: text("primary_photo_url"),
    photoUrls: text("photo_urls", { mode: "json" }).$type<string[]>(),
    description: text("description"),
    biographyRaw: text("biography_raw"),

    goodWithDogs: integer("good_with_dogs", { mode: "boolean" }),
    goodWithCats: integer("good_with_cats", { mode: "boolean" }),
    goodWithKids: integer("good_with_kids", { mode: "boolean" }),
    houseTrained: integer("house_trained", { mode: "boolean" }),
    apartmentFriendly: integer("apartment_friendly", { mode: "boolean" }),
    energyLevel: text("energy_level"),
    specialNeeds: text("special_needs"),
    spayedNeutered: integer("spayed_neutered", { mode: "boolean" }),
    vaccinated: integer("vaccinated", { mode: "boolean" }),
    microchipped: integer("microchipped", { mode: "boolean" }),
    adoptionFee: text("adoption_fee"),
    urgentNotes: text("urgent_notes"),
    fosterNotes: text("foster_notes"),
    holdNotes: text("hold_notes"),

    // Dog-specific contact overrides (usually null; source contact info is inherited)
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    contactUrlOverride: text("contact_url_override"),

    // Freshness lifecycle
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    missingSince: integer("missing_since", { mode: "timestamp_ms" }),
    missedRunCount: integer("missed_run_count").notNull().default(0),
    staleStatus: text("stale_status")
      .$type<StaleStatus>()
      .notNull()
      .default("available"),

    // Change detection / debugging
    contentHash: text("content_hash").notNull(),
    photoHash: text("photo_hash"),
    cardFingerprint: text("card_fingerprint"),
    detailFetchedAt: integer("detail_fetched_at", { mode: "timestamp_ms" }),
    /** Set when meaningful content changed after the first sighting. */
    lastChangedAt: integer("last_changed_at", { mode: "timestamp_ms" }),
    rawPayload: text("raw_payload", { mode: "json" }).$type<Record<string, unknown>>(),

    // Dedupe audit trail
    /** The stable key this listing dedupes on within its source. */
    dedupeKey: text("dedupe_key"),
    /** How the key was derived: strongest available wins. */
    dedupeMethod: text("dedupe_method").$type<
      "source_animal_id" | "original_url" | "weak_fields" | null
    >(),
    /** Another listing this one may duplicate (cross-listing flag, never auto-merged). */
    possibleDuplicateOf: text("possible_duplicate_of"),
    /** 0..1 heuristic confidence that possibleDuplicateOf is the same dog. */
    duplicateConfidence: real("duplicate_confidence"),

    // Future cross-source merge target (assigned by canonical grouping)
    canonicalDogId: integer("canonical_dog_id"),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("dog_listings_source_listing_key").on(t.sourceId, t.listingKey),
    index("dog_listings_source_id").on(t.sourceId),
    index("dog_listings_canonical").on(t.canonicalDogId),
    index("dog_listings_stale").on(t.staleStatus),
  ]
);

/**
 * A canonical dog groups one or more listings believed to be the same animal
 * (relistings within a source, cross-postings across sources). Phase one keeps
 * this deliberately thin: groups are rebuilt deterministically after ingest.
 * Per project policy we over-dedupe when unsure.
 */
export const canonicalDogs = sqliteTable(
  "canonical_dogs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Deterministic key the group was built from (for debuggability). */
    mergeKey: text("merge_key").notNull(),
    displayName: text("display_name"),
    /** The listing chosen to represent the group in UI. */
    displayListingId: text("display_listing_id"),
    listingCount: integer("listing_count").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("canonical_dogs_merge_key").on(t.mergeKey)]
);

/** One ingestion attempt against one source. Recorded for every attempt. */
export const sourceRuns = sqliteTable(
  "source_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id")
      .notNull()
      .references(() => adoptionSources.id),
    /** daily = routine monitoring; backfill = full-inventory initialization. */
    runType: text("run_type").$type<"daily" | "backfill">().notNull().default("daily"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    status: text("status")
      .$type<"success" | "success_with_warnings" | "partial" | "failed" | "blocked">()
      .notNull(),
    listingsFound: integer("listings_found").notNull().default(0),
    dogsFound: integer("dogs_found").notNull().default(0),
    newDogs: integer("new_dogs").notNull().default(0),
    changedDogs: integer("changed_dogs").notNull().default(0),
    unchangedDogs: integer("unchanged_dogs").notNull().default(0),
    unavailableDogs: integer("unavailable_dogs").notNull().default(0),
    missingDogs: integer("missing_dogs").notNull().default(0),
    errorMessage: text("error_message"),
    parserVersion: text("parser_version"),
    htmlHash: text("html_hash"),
    warnings: text("warnings", { mode: "json" }).$type<string[]>(),
    pagesVisited: integer("pages_visited").notNull().default(0),
    detailPagesVisited: integer("detail_pages_visited").notNull().default(0),
    totalListingsReportedBySource: integer("total_listings_reported_by_source"),
    paginationCompleted: integer("pagination_completed", { mode: "boolean" }),
    detailExtractionCompleted: integer("detail_extraction_completed", {
      mode: "boolean",
    }),
    paginationTrace: text("pagination_trace", { mode: "json" }).$type<
      PageTraceEntry[]
    >(),
    // Dedupe + completeness stats
    rawListingsExtracted: integer("raw_listings_extracted").notNull().default(0),
    duplicatesDetected: integer("duplicates_detected").notNull().default(0),
    uniqueListingsSaved: integer("unique_listings_saved").notNull().default(0),
    listingsMissingStableIds: integer("listings_missing_stable_ids").notNull().default(0),
    detailsAttempted: integer("details_attempted").notNull().default(0),
    detailsSucceeded: integer("details_succeeded").notNull().default(0),
    detailsFailed: integer("details_failed").notNull().default(0),
    /** true when the source reported a total and extraction didn't match it. */
    countMismatch: integer("count_mismatch", { mode: "boolean" }),
    /** Rule-based 0..1 trust score for this run (no AI). */
    confidenceScore: real("confidence_score"),
    /** Where raw debug captures for this run live on disk, if saved. */
    rawDebugPath: text("raw_debug_path"),
    /** Whether stale/missing lifecycle updates were applied (false for failed/partial/suspicious runs). */
    missingUpdatesApplied: integer("missing_updates_applied", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [index("source_runs_source_started").on(t.sourceId, t.startedAt)]
);

/** Local, single-user status per dog listing (saved/hidden/contacted/...). */
export const userDogStatuses = sqliteTable("user_dog_statuses", {
  dogListingId: text("dog_listing_id")
    .primaryKey()
    .references(() => dogListings.id),
  status: text("status").$type<UserDogStatus>().notNull(),
  notes: text("notes"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Saved search criteria for future daily alerts. Phase one only stores these
 * and evaluates them with deterministic matchers (no AI scoring yet).
 */
export const savedSearches = sqliteTable("saved_searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** SearchCriteria JSON — see src/lib/match.ts */
  criteria: text("criteria", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Cached geocode results so the same address/city is never resolved twice. */
export const geocodeCache = sqliteTable("geocode_cache", {
  query: text("query").primaryKey(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  precision: text("precision").$type<GeocodePrecision>().notNull(),
  provider: text("provider").notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Claude vision output for one dog's primary photo. Deliberately a SEPARATE
 * table from dog_listings: everything here is MODEL INFERENCE from a single
 * image, not a shelter-provided fact, and must be presented as such in the UI.
 *
 * Cached by photoHash: enrichment is only recomputed when a dog's photo set
 * changes, so re-running the batch is cheap and idempotent. One row per dog
 * (its primary/cover photo) — vision is never run on every image.
 */
export const dogAiEnrichment = sqliteTable(
  "dog_ai_enrichment",
  {
    dogListingId: text("dog_listing_id")
      .primaryKey()
      .references(() => dogListings.id),
    /** photoHash of the dog_listing at analysis time; mismatch = stale, re-run. */
    photoHash: text("photo_hash"),
    imageUrl: text("image_url"),
    model: text("model").notNull(),
    analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).notNull(),

    // Visual reads (all nullable; "unknown" when the model isn't sure).
    coatLength: text("coat_length"), // short | medium | long | hairless | unknown
    coatTexture: text("coat_texture"), // smooth | wiry | curly | fluffy | scruffy | unknown
    apparentColors: text("apparent_colors", { mode: "json" }).$type<string[]>(),
    apparentSize: text("apparent_size"), // tiny | small | medium | large | giant | unknown
    /** Freeform descriptive tags, e.g. ["scruffy","fluffy","senior-looking"]. */
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    /** One–two sentence visual description (AI-written, unverified). */
    visualDescription: text("visual_description"),
    /** clear | blurry | multiple_dogs | no_dog_visible | unknown — flags bad photos. */
    photoQuality: text("photo_quality"),
    /** Model-stated 0..1 confidence in its read. */
    confidence: real("confidence"),
    /** Full structured response, for debugging / re-mapping without re-calling. */
    rawResponse: text("raw_response", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("dog_ai_enrichment_photo_hash").on(t.photoHash)]
);

/**
 * A browser/device subscription for Web Push (PWA notifications). Personal,
 * single-user: whatever devices the owner enabled notifications on. Keyed by
 * the push endpoint (unique per subscription); pruned when the push service
 * reports it's gone (410/404).
 */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastNotifiedAt: integer("last_notified_at", { mode: "timestamp_ms" }),
});

/**
 * A standing watch — a saved natural-language search the overnight scout
 * re-runs on a schedule and alerts on when a genuinely NEW match appears. The
 * parsed criteria are captured at creation so each run evaluates deterministically
 * without re-parsing; the raw query is kept for the alert copy.
 */
export const watches = sqliteTable("watches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  /** The adopter's natural-language query, verbatim (drives the alert wording). */
  query: text("query").notNull(),
  /** ParsedQuery JSON captured at creation — see src/lib/aiSearch.ts. */
  parsed: text("parsed", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  /** Browser-geolocation center when created (for radius/near filters), if shared. */
  latitude: real("latitude"),
  longitude: real("longitude"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  lastNotifiedAt: integer("last_notified_at", { mode: "timestamp_ms" }),
  /** Total dogs this watch has ever alerted on (for the UI). */
  notifiedCount: integer("notified_count").notNull().default(0),
});

/**
 * Dedupe ledger: which dogs a watch has already alerted on, so the overnight
 * scout only ever notifies on genuinely NEW matches (never re-pings the same
 * dog). Composite PK (watchId, dogListingId); cascades when a watch is deleted.
 */
export const watchNotifications = sqliteTable(
  "watch_notifications",
  {
    watchId: integer("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    dogListingId: text("dog_listing_id").notNull(),
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }).notNull(),
    /** Fit score at alert time (audit/debug). */
    score: real("score"),
    /** Whether the Managed Agent curated this alert (vs deterministic fallback). */
    curatedByAgent: integer("curated_by_agent", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.watchId, t.dogListingId] }),
    index("watch_notifications_watch").on(t.watchId),
  ]
);

export type AdoptionSourceRow = typeof adoptionSources.$inferSelect;
export type NewAdoptionSourceRow = typeof adoptionSources.$inferInsert;
export type DogListingRow = typeof dogListings.$inferSelect;
export type NewDogListingRow = typeof dogListings.$inferInsert;
export type SourceRunRow = typeof sourceRuns.$inferSelect;
export type NewSourceRunRow = typeof sourceRuns.$inferInsert;
export type UserDogStatusRow = typeof userDogStatuses.$inferSelect;
export type CanonicalDogRow = typeof canonicalDogs.$inferSelect;
export type DogAiEnrichmentRow = typeof dogAiEnrichment.$inferSelect;
export type NewDogAiEnrichmentRow = typeof dogAiEnrichment.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
export type WatchRow = typeof watches.$inferSelect;
export type NewWatchRow = typeof watches.$inferInsert;
export type WatchNotificationRow = typeof watchNotifications.$inferSelect;
export type NewWatchNotificationRow = typeof watchNotifications.$inferInsert;
