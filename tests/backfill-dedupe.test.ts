import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type ScoutDb } from "@/db";
import { adoptionSources, dogListings, sourceRuns, userDogStatuses } from "@/db/schema";
import { ADAPTERS } from "@/adapters";
import { ingestSource } from "@/ingest/runner";
import { confidenceScore } from "@/ingest/confidence";
import type { AdapterResult, ExtractedDog } from "@/lib/types";

const dog = (over: Partial<ExtractedDog> & { sourceAnimalId: string | null; originalUrl?: string }): ExtractedDog => ({
  originalUrl: over.originalUrl ?? `https://example.org/pets/${over.sourceAnimalId}`,
  name: `Dog ${over.sourceAnimalId}`,
  species: "Dog",
  breedRaw: "Labrador Retriever",
  ageRaw: "3 years",
  sexRaw: "Male",
  sizeRaw: "Medium",
  weightRaw: "40 lbs",
  colorRaw: "Black",
  statusRaw: "Available",
  primaryPhotoUrl: `https://example.org/photos/x.jpg`,
  photoUrls: [`https://example.org/photos/x.jpg`],
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
  ADAPTERS.test = { system: "mock", parserVersion: "test-1.0.0", crawl: async () => fn() };
}

async function makeDb(over: Partial<typeof adoptionSources.$inferInsert> = {}): Promise<ScoutDb> {
  const db = await createDb(":memory:");
  const now = new Date("2026-07-01T00:00:00Z");
  await db
    .insert(adoptionSources)
    .values({
      id: "test_src",
      name: "Test Shelter",
      sourceSystem: "mock",
      adapterType: "test",
      listingUrl: "mock://test",
      state: "CA",
      enabled: true,
      requestDelayMs: 0,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
  return db;
}

const T0 = new Date("2026-07-01T08:00:00Z");
const T1 = new Date("2026-07-02T08:00:00Z");

const srcRow = async (db: ScoutDb) =>
  (await db.select().from(adoptionSources).where(eq(adoptionSources.id, "test_src")).get())!;

describe("backfill initialization gating", () => {
  it("daily runs are skipped until a backfill initializes the source", async () => {
    const db = await makeDb();
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    const daily = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(daily.skipped).toBe(true);
    expect(daily.skipReason).toContain("not initialized");
    expect(await db.select().from(sourceRuns).all()).toHaveLength(0);

    // --force bypasses the gate for debugging
    const forced = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false, force: true });
    expect(forced.skipped).toBe(false);
  });

  it("a successful backfill records stats on the source and initializes it", async () => {
    const db = await makeDb();
    installAdapter(() =>
      okResult([dog({ sourceAnimalId: "A1" }), dog({ sourceAnimalId: "A2" })])
    );
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false, mode: "backfill" });
    expect(s.status).toBe("success");
    expect(s.initializedForDailyMonitoring).toBe(true);
    const src = await srcRow(db);
    expect(src.backfillStatus).toBe("success");
    expect(src.initializedForDailyMonitoring).toBe(true);
    expect(src.backfillUniqueListingsSaved).toBe(2);
    expect(src.backfillRawListingsExtracted).toBe(2);
    expect(src.backfillPaginationCompleted).toBe(true);
    const run = (await db.select().from(sourceRuns).all())[0];
    expect(run.runType).toBe("backfill");
    expect(run.confidenceScore).toBe(1);

    // daily runs now proceed
    const daily = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(daily.skipped).toBe(false);
    expect(daily.status).toBe("success");
  });

  it("a backfill with incomplete pagination does NOT initialize and does NOT mark dogs missing", async () => {
    const db = await makeDb();
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" }), dog({ sourceAnimalId: "A2" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false, mode: "backfill" });

    installAdapter(() =>
      okResult([dog({ sourceAnimalId: "A1" })], { paginationCompleted: false, totalReportedBySource: 2 })
    );
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false, mode: "backfill" });
    expect(s.status).toBe("partial");
    expect(s.initializedForDailyMonitoring).toBe(false);
    expect(s.missingDogs).toBe(0);
    const src = await srcRow(db);
    expect(src.initializedForDailyMonitoring).toBe(false);
    expect(src.backfillStatus).toBe("partial");
    const a2 = (await db.select().from(dogListings).where(eq(dogListings.listingKey, "A2")).get())!;
    expect(a2.staleStatus).toBe("available"); // untouched by the partial backfill
  });

  it("a failed backfill records failure without touching listings", async () => {
    const db = await makeDb();
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false, mode: "backfill" });
    installAdapter(() => {
      throw new Error("kaboom");
    });
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false, mode: "backfill" });
    expect(s.status).toBe("failed");
    const src = await srcRow(db);
    expect(src.backfillStatus).toBe("failed");
    expect(src.initializedForDailyMonitoring).toBe(false);
    expect((await db.select().from(dogListings).all())[0].staleStatus).toBe("available");
  });
});

describe("dedupe stats and audit fields", () => {
  it("merges in-batch duplicates (same dog on two pages) and reports counts", async () => {
    const db = await makeDb({ initializedForDailyMonitoring: true });
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "A1", biographyRaw: "short" }),
        dog({ sourceAnimalId: "A1", biographyRaw: "a much longer richer biography" }),
        dog({ sourceAnimalId: "A2" }),
      ])
    );
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.rawListingsExtracted).toBe(3);
    expect(s.duplicatesDetected).toBe(1);
    expect(s.uniqueListingsSaved).toBe(2);
    expect(await db.select().from(dogListings).all()).toHaveLength(2);
    // the richer record won the merge
    const a1 = (await db.select().from(dogListings).where(eq(dogListings.listingKey, "A1")).get())!;
    expect(a1.biographyRaw).toContain("richer");
    const run = (await db.select().from(sourceRuns).all())[0];
    expect(run.duplicatesDetected).toBe(1);
    expect(run.uniqueListingsSaved).toBe(2);
  });

  it("listing-card + detail-page data land in ONE record (no split dogs)", async () => {
    const db = await makeDb({ initializedForDailyMonitoring: true });
    // Same animal id from a card-only extraction and a detail-fetched extraction.
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "A9", detailFetched: false, biographyRaw: null }),
        dog({ sourceAnimalId: "A9", detailFetched: true, biographyRaw: "full bio from detail page" }),
      ])
    );
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.uniqueListingsSaved).toBe(1);
    const rows = await db.select().from(dogListings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].biographyRaw).toBe("full bio from detail page");
  });

  it("records dedupe keys/methods and flags weak keys", async () => {
    const db = await makeDb({ initializedForDailyMonitoring: true });
    installAdapter(() =>
      okResult([
        dog({ sourceAnimalId: "A1" }),
        dog({ sourceAnimalId: null, originalUrl: "https://example.org/pets/no-id-dog" }),
      ])
    );
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.listingsMissingStableIds).toBe(1);
    expect(s.warnings.some((w) => w.includes("lack a source animal id"))).toBe(true);
    const rows = await db.select().from(dogListings).all();
    const strong = rows.find((r) => r.sourceAnimalId === "A1")!;
    const weak = rows.find((r) => r.sourceAnimalId == null)!;
    expect(strong.dedupeMethod).toBe("source_animal_id");
    expect(strong.dedupeKey).toBe("A1");
    expect(weak.dedupeMethod).toBe("original_url");
    expect(weak.dedupeKey).toMatch(/^url_/);
  });

  it("URL-param changes for the same animal id do not create duplicates", async () => {
    const db = await makeDb({ initializedForDailyMonitoring: true });
    installAdapter(() =>
      okResult([dog({ sourceAnimalId: "A1", originalUrl: "https://example.org/pets/A1?ref=page1" })])
    );
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    installAdapter(() =>
      okResult([dog({ sourceAnimalId: "A1", originalUrl: "https://example.org/pets/A1?ref=page2" })])
    );
    const s = await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    expect(s.newDogs).toBe(0);
    expect(await db.select().from(dogListings).all()).toHaveLength(1);
  });

  it("preserves firstSeenAt, user status, and sets lastChangedAt on content change", async () => {
    const db = await makeDb({ initializedForDailyMonitoring: true });
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })]));
    await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    await db
      .insert(userDogStatuses)
      .values({ dogListingId: "test_src::A1", status: "saved", updatedAt: T0 })
      .run();

    installAdapter(() => okResult([dog({ sourceAnimalId: "A1", statusRaw: "Adoption Pending" })]));
    await ingestSource(db, "test_src", { now: T1, saveRawDebug: false });
    const row = (await db.select().from(dogListings).all())[0];
    expect(row.firstSeenAt).toEqual(T0);
    expect(row.lastChangedAt).toEqual(T1);
    const status = (await db.select().from(userDogStatuses).all())[0];
    expect(status.status).toBe("saved"); // untouched by updates

    // unchanged run: lastChangedAt stays put
    const T2 = new Date("2026-07-03T08:00:00Z");
    await ingestSource(db, "test_src", { now: T2, saveRawDebug: false });
    const row2 = (await db.select().from(dogListings).all())[0];
    expect(row2.lastChangedAt).toEqual(T1);
    expect(row2.lastSeenAt).toEqual(T2);
  });
});

describe("run classification + confidence", () => {
  it("success with warnings is distinguished from clean success", async () => {
    const db = await makeDb({ initializedForDailyMonitoring: true });
    installAdapter(() => okResult([dog({ sourceAnimalId: "A1" })], { warnings: ["minor note"] }));
    const s = await ingestSource(db, "test_src", { now: T0, saveRawDebug: false });
    expect(s.status).toBe("success_with_warnings");
    expect(s.missingUpdatesApplied).toBe(true); // still conclusive
  });

  it("confidence scoring follows the rules (no AI)", () => {
    const base = {
      status: "success" as const,
      dogsFound: 100,
      paginationCompleted: true,
      detailExtractionCompleted: true,
      detailsAttempted: 100,
      detailsFailed: 0,
      totalReportedBySource: 100,
      countMismatch: false,
      listingsMissingStableIds: 0,
      photosPresent: 100,
      originalUrlsPresent: 100,
      warningsCount: 0,
    };
    expect(confidenceScore(base)).toBe(1);
    expect(confidenceScore({ ...base, status: "failed" })).toBe(0);
    expect(confidenceScore({ ...base, status: "blocked" })).toBe(0);
    expect(confidenceScore({ ...base, dogsFound: 0 })).toBe(0.1);
    expect(confidenceScore({ ...base, paginationCompleted: false })).toBeLessThan(0.75);
    expect(confidenceScore({ ...base, detailsFailed: 30 })).toBeLessThan(0.95);
    expect(confidenceScore({ ...base, listingsMissingStableIds: 60 })).toBeLessThan(0.8);
    expect(confidenceScore({ ...base, countMismatch: true })).toBeLessThanOrEqual(0.85);
  });
});
