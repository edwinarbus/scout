import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type ScoutDb } from "@/db";
import { adoptionSources, dogListings, savedSearches, sourceRuns, userDogStatuses } from "@/db/schema";
import { ADAPTERS } from "@/adapters";
import { ingestSource, rebuildCanonicalGroups } from "@/ingest/runner";
import { buildDogViews } from "@/lib/dogView";
import type { AdapterResult, ExtractedDog } from "@/lib/types";

/** Minimal extraction builder. */
const dog = (over: Partial<ExtractedDog> & { sourceAnimalId: string }): ExtractedDog => ({
  originalUrl: `https://example.org/pets/${over.sourceAnimalId}`,
  name: `Dog ${over.sourceAnimalId}`,
  species: "Dog",
  breedRaw: "Labrador Retriever",
  ageRaw: "3 years",
  sexRaw: "Male",
  sizeRaw: "Medium",
  weightRaw: "40 lbs",
  colorRaw: "Black",
  statusRaw: "Available",
  primaryPhotoUrl: `https://example.org/photos/${over.sourceAnimalId}.jpg`,
  photoUrls: [`https://example.org/photos/${over.sourceAnimalId}.jpg`],
  rawPayload: {},
  detailFetched: true,
  ...over,
});

const okResult = (dogs: ExtractedDog[], over: Partial<AdapterResult> = {}): AdapterResult => ({
  dogs,
  totalReportedBySource: dogs.length,
  pagesVisited: 1,
  detailPagesVisited: dogs.length,
  detailsAttempted: dogs.length,
  detailsSucceeded: dogs.length,
  detailsFailed: 0,
  paginationCompleted: true,
  detailExtractionCompleted: true,
  warnings: [],
  paginationTrace: [{ url: "mock://test", page: 1, resultCount: dogs.length }],
  htmlHash: "abc",
  ...over,
});

function installAdapter(fn: () => Promise<AdapterResult> | AdapterResult) {
  ADAPTERS.test = {
    system: "mock",
    parserVersion: "test-1.0.0",
    crawl: async () => fn(),
  };
}

async function makeDb(): Promise<ScoutDb> {
  const db = await createDb(":memory:");
  const now = new Date("2026-07-01T00:00:00Z");
  await db
    .insert(adoptionSources)
    .values({
      id: "test_src",
      name: "Test Shelter",
      sourceSystem: "mock",
      adapterType: "test",
      listingUrl: "mock://test", // non-http → robots check skipped
      state: "CA",
      city: "San Francisco",
      county: "San Francisco",
      latitude: 37.77,
      longitude: -122.42,
      geocodePrecision: "campus",
      phone: "(555) 111-2222",
      email: "adopt@test.example",
      enabled: true,
      initializedForDailyMonitoring: true, // daily runs are gated on backfill
      requestDelayMs: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return db;
}

const listing = async (db: ScoutDb, key: string) =>
  (await db.select().from(dogListings).where(eq(dogListings.listingKey, key)).get())!;

const T0 = new Date("2026-07-01T08:00:00Z");
const T1 = new Date("2026-07-02T08:00:00Z");
const T2 = new Date("2026-07-03T08:00:00Z");
const T3 = new Date("2026-07-04T08:00:00Z");
const T4 = new Date("2026-07-05T08:00:00Z");

describe("ingestion runner", () => {
  let db: ScoutDb;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("inserts new listings with lifecycle + hashes, and records a SourceRun", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" }), dog({ sourceAnimalId: "A2" })]));
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.status).toBe("success");
    expect(s.newDogs).toBe(2);
    const row = await listing(db, "A1");
    expect(row.id).toBe("test_src::A1");
    expect(row.staleStatus).toBe("available");
    expect(row.contentHash).toBeTruthy();
    expect(row.firstSeenAt).toEqual(T0);
    expect(row.statusNormalized).toBe("available");
    const run = (await db.select().from(sourceRuns).all())[0];
    expect(run.status).toBe("success");
    expect(run.dogsFound).toBe(2);
    expect(run.paginationCompleted).toBe(true);
    expect(run.missingUpdatesApplied).toBe(true);
    expect(run.paginationTrace).toHaveLength(1);
  });

  it("upserts: unchanged dogs bump lastSeenAt without duplicates; changes are detected", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    const s2 = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s2.newDogs).toBe(0);
    expect(s2.unchangedDogs).toBe(1);
    expect(await db.select().from(dogListings).all()).toHaveLength(1);
    let row = await listing(db, "A1");
    expect(row.lastSeenAt).toEqual(T1);
    expect(row.firstSeenAt).toEqual(T0);
    expect(row.staleStatus).toBe("still_seen");

    installAdapter(() => okResult([dog({ sourceAnimalId: "A1", statusRaw: "Adoption Pending" })]));
    const s3 = await ingestSource(db, "test_src", { now: T2, saveRawDebug: false });
    expect(s3.changedDogs).toBe(1);
    row = await listing(db, "A1");
    expect(row.statusNormalized).toBe("pending");
    expect(row.firstSeenAt).toEqual(T0); // never reset on change
  });

  it("escalates missing dogs cautiously across successful runs, and resets on reappearance", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" }), dog({ sourceAnimalId: "A2" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });

    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    const s2 = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s2.missingDogs).toBe(1);
    let a2 = await listing(db, "A2");
    expect(a2.staleStatus).toBe("missing_once");
    expect(a2.missingSince).toEqual(T1);

    await ingestSource(db, "test_src", { now: T2, saveRawDebug: false });
    a2 = await listing(db, "A2");
    expect(a2.staleStatus).toBe("missing_multiple_runs");
    expect(a2.missingSince).toEqual(T1); // first-missing preserved

    await ingestSource(db, "test_src", { now: T3, saveRawDebug: false });
    await ingestSource(db, "test_src", { now: T4, saveRawDebug: false });
    a2 = await listing(db, "A2");
    expect(a2.staleStatus).toBe("likely_unavailable");

    // reappears → fully reset
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" }), dog({ sourceAnimalId: "A2" })]));
    await ingestSource(db, "test_src", { now: new Date("2026-07-06T08:00:00Z"), saveRawDebug: false });
    a2 = await listing(db, "A2");
    expect(a2.staleStatus).toBe("still_seen");
    expect(a2.missingSince).toBeNull();
    expect(a2.missedRunCount).toBe(0);
  });

  it("NEVER marks dogs missing after a failed run", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });

    installAdapter(() => {
      throw new Error("site exploded");
    });
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toContain("site exploded");
    const row = await listing(db, "A1");
    expect(row.staleStatus).toBe("available"); // untouched
    expect(row.lastSeenAt).toEqual(T0);
    const runs = await db.select().from(sourceRuns).all();
    expect(runs.at(-1)!.status).toBe("failed");
    expect(runs.at(-1)!.missingUpdatesApplied).toBe(false);
  });

  it("NEVER marks dogs missing after a partial run (incomplete pagination)", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" }), dog({ sourceAnimalId: "A2" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });

    installAdapter(() =>
      okResult([dog({ sourceAnimalId: "A1" })], {
        paginationCompleted: false,
        totalReportedBySource: 2,
      })
    );
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s.status).toBe("partial");
    expect(s.missingDogs).toBe(0);
    expect(s.missingUpdatesApplied).toBe(false);
    expect((await listing(db, "A2")).staleStatus).toBe("available");
    // but the seen dog still gets its lastSeenAt bump
    expect((await listing(db, "A1")).lastSeenAt).toEqual(T1);
  });

  it("treats zero dogs as partial (parser break guard), not as everything-adopted", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    installAdapter(() => okResult([]));
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s.status).toBe("partial");
    expect((await listing(db, "A1")).staleStatus).toBe("available");
  });

  it("treats a sharp count drop as partial and freezes stale statuses", async () => {
    const many = Array.from({ length: 20 }, (_, i) => dog({ sourceAnimalId: `A${i}` }));
    installAdapter(() => okResult(many));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    installAdapter(() => okResult(many.slice(0, 5)));
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s.status).toBe("partial");
    expect(s.warnings.some((w) => w.includes("dropped sharply"))).toBe(true);
    expect(s.missingDogs).toBe(0);
    expect((await listing(db, "A19")).staleStatus).toBe("available");
  });

  it("preserves detail-only fields when the adapter skips an unchanged detail page", async () => {
    installAdapter(() =>
      okResult([
        dog({
          sourceAnimalId: "A1",
          biographyRaw: "A wonderful long biography.",
          goodWithCats: true,
          cardFingerprint: "card-v1",
          detailFetched: true,
        }),
      ])
    );
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });

    // next run: card unchanged → adapter returns card-only extraction
    installAdapter(() =>
      okResult([
        dog({
          sourceAnimalId: "A1",
          biographyRaw: null,
          goodWithCats: null,
          cardFingerprint: "card-v1",
          detailFetched: false,
        }),
      ])
    );
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s.unchangedDogs).toBe(1);
    const row = await listing(db, "A1");
    expect(row.biographyRaw).toBe("A wonderful long biography."); // preserved
    expect(row.goodWithCats).toBe(true);
    expect(row.detailFetchedAt).toEqual(T0);
  });

  it("records failed run for unimplemented adapter types", async () => {
    await db
      .update(adoptionSources)
      .set({ adapterType: "unknown" })
      .where(eq(adoptionSources.id, "test_src"))
      .run();
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toContain("no adapter implemented");
    expect(await db.select().from(sourceRuns).all()).toHaveLength(1);
  });

  it("skips disabled sources without recording a run", async () => {
    await db
      .update(adoptionSources)
      .set({ enabled: false })
      .where(eq(adoptionSources.id, "test_src"))
      .run();
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.skipped).toBe(true);
    expect(await db.select().from(sourceRuns).all()).toHaveLength(0);
  });
});

describe("dog views (UI shape)", () => {
  let db: ScoutDb;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("inherits contact info from the source, dog overrides win", async () => {
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "A1" }),
        dog({ sourceAnimalId: "A2", contactPhone: "(555) 999-0000" }),
      ])
    );
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T0);
    const views = await buildDogViews(db, T0);
    const a1 = views.find((v) => v.id === "test_src::A1")!;
    const a2 = views.find((v) => v.id === "test_src::A2")!;
    expect(a1.contact.phone).toBe("(555) 111-2222"); // inherited
    expect(a1.contact.phoneIsOverride).toBe(false);
    expect(a1.contact.email).toBe("adopt@test.example");
    expect(a2.contact.phone).toBe("(555) 999-0000"); // dog-specific override
    expect(a2.contact.phoneIsOverride).toBe(true);
  });

  it("resolves geocode precision through the fallback ladder", async () => {
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "EXACT", latitude: 37.1, longitude: -122.1, geocodePrecision: "exact_shelter" }),
        dog({ sourceAnimalId: "CAMPUS" }), // inherits source campus coords
      ])
    );
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    // a source without coords → city fallback
    await db
      .update(adoptionSources)
      .set({ latitude: null, longitude: null })
      .where(eq(adoptionSources.id, "test_src"))
      .run();
    installAdapter(() => okResult([
      dog({ sourceAnimalId: "EXACT", latitude: 37.1, longitude: -122.1, geocodePrecision: "exact_shelter" }),
      dog({ sourceAnimalId: "CAMPUS" }),
      dog({ sourceAnimalId: "CITY", city: "Oakland" }),
    ]));
    await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T1);
    const views = await buildDogViews(db, T1);
    expect(views.find((v) => v.id === "test_src::EXACT")!.geocodePrecision).toBe("exact_shelter");
    expect(views.find((v) => v.id === "test_src::CITY")!.geocodePrecision).toBe("city");
    const campus = views.find((v) => v.id === "test_src::CAMPUS")!;
    expect(campus.geocodePrecision).toBe("city"); // source lost coords → city of source
  });

  it("collapses canonical duplicates into one view with duplicate links", async () => {
    // second source cross-posting the same dog
    await db
      .insert(adoptionSources)
      .values({
        id: "test_src2",
        name: "Cross-post Rescue",
        sourceSystem: "mock",
        adapterType: "test",
        listingUrl: "mock://test2",
        state: "CA",
        enabled: true,
        initializedForDailyMonitoring: true,
        requestDelayMs: 0,
        createdAt: T0,
        updatedAt: T0,
      })
      .run();
    installAdapter(() => okResult([dog({ sourceAnimalId: "X1", name: "Waffles", sexRaw: "Female" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    installAdapter(() => okResult([dog({ sourceAnimalId: "Y9", name: "Waffles", sexRaw: "Female" })]));
    await ingestSource(db, "test_src2", { now: T1, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T1);
    const views = await buildDogViews(db, T1);
    const waffles = views.filter((v) => v.name === "Waffles");
    expect(waffles).toHaveLength(1); // over-deduped to one card
    expect(waffles[0].duplicates).toHaveLength(1);
    expect(waffles[0].duplicates[0].originalUrl).toContain("example.org");
  });

  it("computes saved-search matches and exposes user statuses", async () => {
    await db
      .insert(savedSearches)
      .values({
        name: "labs near sf",
        enabled: true,
        criteria: { breedIncludes: ["labrador"] } as unknown as Record<string, unknown>,
        createdAt: T0,
        updatedAt: T0,
      })
      .run();
    // intake on/after the NEW cutoff (2026-07-02) → flagged "just arrived"
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1", intakeDateRaw: "2026-07-05" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T0);
    await db
      .insert(userDogStatuses)
      .values({ dogListingId: "test_src::A1", status: "saved", updatedAt: T0 })
      .run();
    const views = await buildDogViews(db, T0);
    expect(views[0].matchedSearches).toEqual(["labs near sf"]);
    expect(views[0].userStatus).toBe("saved");
    expect(views[0].isNew).toBe(true); // intake ≥ cutoff
  });

  it("isNew is false when intake predates the cutoff or is unknown", async () => {
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "OLD", intakeDateRaw: "2026-05-01" }),
        dog({ sourceAnimalId: "NONE", intakeDateRaw: null }),
      ])
    );
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T0);
    const views = await buildDogViews(db, T0);
    expect(views.every((v) => v.isNew === false)).toBe(true);
  });

  it("isNew + daysInShelter handle MM/DD/YYYY intake dates (Oakland format)", async () => {
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "MDYNEW", intakeDateRaw: "07/05/2026" }), // after cutoff
        dog({ sourceAnimalId: "MDYOLD", intakeDateRaw: "01/31/2022" }), // long ago
      ])
    );
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T0);
    const views = await buildDogViews(db, T0);
    const yes = views.find((v) => v.id === "test_src::MDYNEW")!;
    const no = views.find((v) => v.id === "test_src::MDYOLD")!;
    expect(yes.isNew).toBe(true); // MM/DD/YYYY parsed, not string-compared
    expect(no.isNew).toBe(false);
    expect(no.daysInShelter).not.toBeNull(); // Date.parse would have given null
  });

  it("computes daysInShelter from intake date, null when the source has none", async () => {
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "WITHINTAKE", intakeDateRaw: "2026-06-01" }),
        dog({ sourceAnimalId: "NOINTAKE", intakeDateRaw: null }),
      ])
    );
    // now = 2026-07-01 → 30 days after intake
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T0);
    const views = await buildDogViews(db, T0);
    const withIntake = views.find((v) => v.sourceAnimalId === "WITHINTAKE")!;
    const noIntake = views.find((v) => v.sourceAnimalId === "NOINTAKE")!;
    expect(withIntake.daysInShelter).toBe(30);
    expect(noIntake.daysInShelter).toBeNull(); // never fabricated
    // stable across re-derivation and doesn't churn the content hash
    expect(withIntake.intakeDate).toBe("2026-06-01");
  });

  it("never returns negative daysInShelter for future intake dates (clock skew)", async () => {
    installAdapter(() => okResult([dog({ sourceAnimalId: "FUTURE", intakeDateRaw: "2026-12-01" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await rebuildCanonicalGroups(db, T0);
    expect((await buildDogViews(db, T0))[0].daysInShelter).toBeNull();
  });
});
