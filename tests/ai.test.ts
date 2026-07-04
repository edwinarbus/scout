import { describe, expect, it } from "vitest";
import type { DogView } from "@/lib/dogView";
import {
  applyParsedQuery,
  candidateBlock,
  chipsFromParsed,
  chunkArray,
  gateByFit,
  mergeRerank,
  MIN_FIT_SCORE,
  normalizeParsed,
  RERANK_CHUNK_SIZE,
  RERANK_SHORTLIST_SIZE,
  toSearchCriteria,
  type DogAiTags,
  type ParsedQuery,
  type SearchMatch,
} from "@/lib/aiSearch";
import { screeningLines } from "@/lib/screening";
import {
  formatContextLine,
  isDogCharacteristicTag,
  isPersonFreeDescription,
  mapVisionToRow,
  selectCandidates,
  VISION_SYSTEM_PROMPT,
  type VisionResult,
} from "@/ingest/enrich";

const emptyParsed = (over: Partial<ParsedQuery> = {}): ParsedQuery => ({
  breedIncludes: [],
  breedExcludes: [],
  sizes: [],
  ageBuckets: [],
  excludePuppies: false,
  colors: [],
  sexes: [],
  minWeightLbs: null,
  maxWeightLbs: null,
  minDaysInShelter: null,
  maxDaysInShelter: null,
  nearPlace: null,
  maxDistanceMiles: null,
  visualTraits: [],
  keywords: [],
  interpretation: "",
  ...over,
});

const dog = (over: Partial<DogView> & { id: string }): DogView =>
  ({
    name: "Rex",
    breedNormalized: "labrador retriever",
    breedRaw: "Labrador Retriever",
    ageMonthsEstimate: 48,
    ageRaw: "4 years",
    ageBucket: "adult",
    sex: "male",
    sizeNormalized: "large",
    weightLbsEstimate: 65,
    colorsNormalized: ["black"],
    colorRaw: "Black",
    statusNormalized: "available",
    freshness: "fresh",
    latitude: 37.77,
    longitude: -122.42,
    biographyRaw: null,
    description: null,
    matchedSearches: [],
    ai: null,
    ...over,
  }) as DogView;

describe("toSearchCriteria", () => {
  it("maps named place to a center with a default radius, and scalar flags", () => {
    const c = toSearchCriteria(
      emptyParsed({
        breedIncludes: ["dachshund"],
        sizes: ["small"],
        excludePuppies: true,
        nearPlace: "San Francisco",
      })
    );
    expect(c.breedIncludes).toEqual(["dachshund"]);
    expect(c.sizes).toEqual(["small"]);
    expect(c.excludePuppies).toBe(true);
    expect(c.center).toBeTruthy();
    expect(c.maxDistanceMiles).toBe(100); // default when a place is named without a radius
  });

  it("respects an explicit radius and leaves center unset for unknown places", () => {
    expect(toSearchCriteria(emptyParsed({ nearPlace: "San Francisco", maxDistanceMiles: 25 })).maxDistanceMiles).toBe(25);
    expect(toSearchCriteria(emptyParsed({ nearPlace: "Narnia" })).center).toBeUndefined();
    expect(toSearchCriteria(emptyParsed()).center).toBeUndefined();
  });

  it("uses the browser location as center (100 mi default) when no place is named", () => {
    const c = toSearchCriteria(emptyParsed(), { latitude: 34.05, longitude: -118.24 });
    expect(c.center).toEqual({ latitude: 34.05, longitude: -118.24 });
    expect(c.maxDistanceMiles).toBe(100);
  });

  it("a place named in the query beats the browser location", () => {
    const c = toSearchCriteria(emptyParsed({ nearPlace: "San Francisco" }), {
      latitude: 34.05,
      longitude: -118.24,
    });
    // SF is ~37.7N; the LA browser coords must not win.
    expect(c.center!.latitude).toBeGreaterThan(37);
  });

  it("maps weight and length-of-stay bounds into hard criteria", () => {
    const c = toSearchCriteria(
      emptyParsed({ maxWeightLbs: 25, minDaysInShelter: 60 })
    );
    expect(c.weightLbsMax).toBe(25);
    expect(c.daysInShelterMin).toBe(60);
  });
});

describe("applyParsedQuery (deterministic ranking + reasons)", () => {
  const dogs: DogView[] = [
    dog({ id: "doxie", name: "Biscuit", breedNormalized: "dachshund", breedRaw: "Dachshund", sizeNormalized: "small", biographyRaw: "A cuddly lap dog." }),
    dog({ id: "husky", name: "Sky", breedNormalized: "husky", breedRaw: "Husky", sizeNormalized: "large" }),
    dog({ id: "doxie2", name: "Waffles", breedNormalized: "dachshund", breedRaw: "Dachshund", sizeNormalized: "small", biographyRaw: "Quiet senior." }),
  ];
  const aiTags = new Map<string, DogAiTags>([
    ["doxie", { tags: ["scruffy", "small"], coatTexture: "wiry", coatLength: "medium", apparentSize: "small", visualDescription: "A small scruffy dog." }],
  ]);

  it("hard-filters by breed and ranks soft trait + keyword hits with reasons", () => {
    const matches = applyParsedQuery(
      emptyParsed({ breedIncludes: ["dachshund"], visualTraits: ["scruffy"], keywords: ["cuddly"] }),
      dogs,
      aiTags
    );
    // Only dachshunds pass the hard breed filter.
    expect(matches.map((m) => m.dog.id)).toEqual(["doxie", "doxie2"]);
    // Biscuit ranks first: breed + AI "scruffy" + bio "cuddly".
    const top = matches[0];
    expect(top.dog.id).toBe("doxie");
    expect(top.reasons.some((r) => r.includes("dachshund"))).toBe(true);
    expect(top.reasons.some((r) => /scruffy.*AI read/i.test(r))).toBe(true);
    expect(top.reasons.some((r) => /bio mentions "cuddly"/.test(r))).toBe(true);
    expect(top.score).toBeGreaterThan(matches[1].score);
  });

  it("excludes non-matching breeds entirely", () => {
    const matches = applyParsedQuery(emptyParsed({ breedIncludes: ["husky"] }), dogs, aiTags);
    expect(matches.map((m) => m.dog.id)).toEqual(["husky"]);
  });

  it("unknown data never rejects a match (surfaced as unknowns)", () => {
    const noColorDog = dog({ id: "x", colorsNormalized: [] });
    const matches = applyParsedQuery(emptyParsed({ colors: ["black"] }), [noColorDog], new Map());
    expect(matches).toHaveLength(1);
    expect(matches[0].unknowns.length).toBeGreaterThan(0);
  });

  it("filters by length of stay; unknown intake never rejects", () => {
    const longStay = dog({ id: "long", daysInShelter: 90 } as Partial<DogView> & { id: string });
    const shortStay = dog({ id: "short", daysInShelter: 10 } as Partial<DogView> & { id: string });
    const noIntake = dog({ id: "noint", daysInShelter: null } as Partial<DogView> & { id: string });
    const matches = applyParsedQuery(
      emptyParsed({ minDaysInShelter: 60 }),
      [longStay, shortStay, noIntake],
      new Map()
    );
    const ids = matches.map((m) => m.dog.id);
    expect(ids).toContain("long");
    expect(ids).not.toContain("short"); // known 10 days → hard fail
    expect(ids).toContain("noint"); // unknown → kept, surfaced as unknown
    expect(matches.find((m) => m.dog.id === "noint")!.unknowns.join(" ")).toMatch(/length of stay/i);
  });
});

describe("staged-search helpers", () => {
  it("chipsFromParsed renders every understood criterion as a labeled chip", () => {
    const chips = chipsFromParsed(
      emptyParsed({
        breedIncludes: ["dachshund"],
        breedExcludes: ["husky"],
        sizes: ["small"],
        maxWeightLbs: 25,
        minDaysInShelter: 60,
        nearPlace: "Oakland",
        visualTraits: ["one floppy ear"],
        keywords: ["good with cats"],
      })
    );
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("dachshund");
    expect(labels).toContain("no husky");
    expect(labels).toContain("under 25 lbs");
    expect(labels).toContain("waiting 2 months+");
    expect(labels).toContain("near Oakland · 100 mi");
    expect(labels).toContain("one floppy ear");
    expect(labels).toContain("good with cats");
    // kinds drive chip color: hard filters vs soft ranking vs geography
    expect(chips.find((c) => c.label === "one floppy ear")!.kind).toBe("soft");
    expect(chips.find((c) => c.label === "under 25 lbs")!.kind).toBe("hard");
    expect(chips.find((c) => c.label.startsWith("near"))!.kind).toBe("place");
  });

  it("chipsFromParsed is empty for an empty parse (nothing invented)", () => {
    expect(chipsFromParsed(emptyParsed())).toEqual([]);
  });

  it("screeningLines builds cute, specific per-dog loading lines from the query", () => {
    const lines = screeningLines(
      emptyParsed({ visualTraits: ["one floppy ear"], keywords: ["good with cats"] }),
      ["Sidney", "Astro"]
    );
    // one line per understood trait/keyword, each naming a real candidate
    expect(lines.some((l) => /Sidney's ear floppiness/.test(l))).toBe(true);
    expect(lines.some((l) => /Astro's temperament with felines/.test(l))).toBe(true);
  });

  it("screeningLines falls back gracefully with no names and no criteria", () => {
    const lines = screeningLines(emptyParsed(), []);
    // a generous, playful run even with nothing to go on — every line still
    // names the (placeholder) pup, and nothing is empty
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.every((l) => l.includes("this pup"))).toBe(true);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("normalizeParsed coerces malformed echoes into a safe ParsedQuery", () => {
    const p = normalizeParsed({
      breedIncludes: ["poodle", 42, null],
      sizes: ["small", "gigantic"],
      excludePuppies: "yes", // not boolean true
      maxWeightLbs: "25", // not a number
      minDaysInShelter: 60,
      nearPlace: 7,
      interpretation: null,
    });
    expect(p.breedIncludes).toEqual(["poodle"]);
    expect(p.sizes).toEqual(["small"]);
    expect(p.excludePuppies).toBe(false);
    expect(p.maxWeightLbs).toBeNull();
    expect(p.minDaysInShelter).toBe(60);
    expect(p.nearPlace).toBeNull();
    expect(p.interpretation).toBe("");
    expect(normalizeParsed(null)).toMatchObject({ breedIncludes: [], keywords: [] });
  });
});

describe("re-rank stage (pure pieces)", () => {
  const match = (id: string, score: number, over: Partial<DogView> = {}): SearchMatch => ({
    dog: dog({ id, ...over } as Partial<DogView> & { id: string }),
    score,
    reasons: [`det-${id}`],
    unknowns: [],
  });

  it("candidateBlock packs facts, bio, and photo read into labeled lines", () => {
    const m = match("d1", 3, {
      name: "Waffles",
      weightLbsEstimate: 22,
      daysInShelter: 75,
      biographyRaw: "A gentle couch potato who loves everyone.",
      ai: {
        tags: ["scruffy"],
        coatLength: "medium",
        coatTexture: "wiry",
        apparentSize: "small",
        apparentColors: ["tan"],
        visualDescription: "A small scruffy dog with one floppy ear.",
        photoQuality: "clear",
        confidence: 0.9,
        model: "claude-haiku-4-5",
        analyzedAt: 0,
      } as unknown as DogView["ai"],
    });
    const block = candidateBlock(m);
    expect(block).toContain("id=d1");
    expect(block).toContain("weight=22lbs");
    expect(block).toContain("daysInShelter=75");
    expect(block).toContain('bio: "A gentle couch potato');
    expect(block).toContain("photo read:");
    expect(block).toContain("one floppy ear");
  });

  it("candidateBlock says 'none' rather than inventing missing bio/photo data", () => {
    const block = candidateBlock(match("d2", 1, { biographyRaw: null, ai: null }));
    expect(block).toContain("bio: none");
    expect(block).toContain("photo read: none");
  });

  it("mergeRerank re-scores and re-orders by Claude's fit, keeping unscored dogs after", () => {
    const all = [match("a", 5), match("b", 4), match("c", 3)];
    const merged = mergeRerank(all, {
      results: [
        { id: "b", score: 95, reasons: ["breed-typical: suits apartments"], caveats: ["no data on cats"] },
        { id: "a", score: 40, reasons: [], caveats: [] },
      ],
    });
    expect(merged.map((m) => m.dog.id)).toEqual(["b", "a", "c"]);
    expect(merged[0].score).toBe(95);
    expect(merged[0].reasons).toEqual(["breed-typical: suits apartments"]);
    expect(merged[0].unknowns).toContain("no data on cats");
    // Claude returned no reasons for "a" → deterministic reasons kept.
    expect(merged[1].reasons).toEqual(["det-a"]);
  });

  it("mergeRerank is a no-op when the re-rank stage failed (null)", () => {
    const all = [match("a", 5), match("b", 4)];
    expect(mergeRerank(all, null)).toBe(all);
  });

  it("mergeRerank clamps out-of-range scores", () => {
    const merged = mergeRerank([match("a", 5)], {
      results: [{ id: "a", score: 250, reasons: ["x"], caveats: [] }],
    });
    expect(merged[0].score).toBe(100);
  });

  it("chunkArray splits the shortlist into parallel-scoreable chunks", () => {
    expect(chunkArray([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunkArray([], 3)).toEqual([]);
    expect(chunkArray([1], 5)).toEqual([[1]]);
    // the real shapes: 40 dogs in chunks of 5 → 8 concurrent calls
    expect(chunkArray(Array.from({ length: RERANK_SHORTLIST_SIZE }), RERANK_CHUNK_SIZE)).toHaveLength(8);
  });

  it("a partially-failed rerank (some chunks missing) still merges what scored", () => {
    // dogs a,b scored (their chunk succeeded); c's chunk failed → keeps deterministic slot
    const all = [match("a", 5), match("b", 4), match("c", 3)];
    const merged = mergeRerank(all, {
      results: [
        { id: "a", score: 30, reasons: ["shelter facts: small"], caveats: [] },
        { id: "b", score: 90, reasons: ["bio: 'apartment dog'"], caveats: [] },
      ],
    });
    expect(merged.map((m) => m.dog.id)).toEqual(["b", "a", "c"]);
    expect(merged[2].reasons).toEqual(["det-c"]); // untouched deterministic reasons
  });

  it("gateByFit drops low-fit dogs once Claude has scored them (precision gate)", () => {
    // a Sacramento pit bull the model scored low for "scruffy near Oakland"
    // should NOT survive; genuine fits (>= MIN_FIT_SCORE) do.
    const merged = mergeRerank([match("good", 5), match("bad", 4), match("edge", 3)], {
      results: [
        { id: "good", score: 88, reasons: ["scruffy terrier, near Oakland"], caveats: [] },
        { id: "bad", score: 20, reasons: [], caveats: ["breed is Pit Bull; in Sacramento, far from Oakland"] },
        { id: "edge", score: MIN_FIT_SCORE, reasons: [], caveats: [] },
      ],
    });
    const gated = gateByFit(merged, true);
    expect(gated.map((m) => m.dog.id)).toEqual(["good", "edge"]); // "bad" dropped, boundary kept
  });

  it("gateByFit is a no-op before the re-rank runs (deterministic scores aren't 0–100)", () => {
    // in the fast filter pass the scores are small deterministic tallies — gating
    // them at 55 would wrongly empty the list, so the gate only applies once reranked.
    const all = [match("a", 5), match("b", 4)];
    expect(gateByFit(all, false)).toBe(all);
  });
});

describe("vision enrichment mapping", () => {
  const result: VisionResult = {
    dog_visible: true,
    photo_quality: "clear",
    coat_length: "long",
    coat_texture: "Scruffy",
    apparent_colors: ["Black", "TAN"],
    apparent_size: "small",
    tags: ["Scruffy", "senior-looking"],
    visual_description: "  A small scruffy senior dog.  ",
    confidence: 1.4, // out of range on purpose
  };

  it("lowercases, trims, clamps confidence, and normalizes 'unknown' to null", () => {
    const row = mapVisionToRow(
      { id: "d1", primaryPhotoUrl: "https://x/a.jpg", photoHash: "h1" },
      result,
      new Date("2026-07-02T00:00:00Z")
    );
    expect(row.dogListingId).toBe("d1");
    expect(row.coatTexture).toBe("scruffy");
    expect(row.apparentColors).toEqual(["black", "tan"]);
    expect(row.tags).toEqual(["scruffy", "senior-looking"]);
    expect(row.visualDescription).toBe("A small scruffy senior dog.");
    expect(row.confidence).toBe(1); // clamped to [0,1]
    expect(row.photoHash).toBe("h1");
  });

  it("drops the description and marks photo when no dog is visible", () => {
    const row = mapVisionToRow(
      { id: "d2", primaryPhotoUrl: "https://x/b.jpg", photoHash: "h2" },
      { ...result, dog_visible: false, photo_quality: "no_dog_visible", coat_length: "unknown" },
      new Date()
    );
    expect(row.visualDescription).toBeNull();
    expect(row.photoQuality).toBe("no_dog_visible");
    expect(row.coatLength).toBeNull(); // "unknown" → null
  });

  it("strips object/accessory tags even if the model includes them", () => {
    const row = mapVisionToRow(
      { id: "d3", primaryPhotoUrl: "https://x/c.jpg", photoHash: "h3" },
      { ...result, tags: ["scruffy", "yellow-collar", "red-bandana", "on-a-leash", "fluffy"] },
      new Date()
    );
    expect(row.tags).toEqual(["scruffy", "fluffy"]);
  });

  it("drops the whole description (not just the mention) when it names a person", () => {
    const row = mapVisionToRow(
      { id: "d4", primaryPhotoUrl: "https://x/d.jpg", photoHash: "h4" },
      { ...result, visual_description: "A solid black puppy being held up by a person." },
      new Date()
    );
    expect(row.visualDescription).toBeNull();
  });
});

describe("isDogCharacteristicTag (backstop against object/accessory tags)", () => {
  it("keeps physical and temperament traits", () => {
    for (const t of ["scruffy", "fluffy", "senior-looking", "one-eye", "floppy-ears", "athletic"]) {
      expect(isDogCharacteristicTag(t)).toBe(true);
    }
  });

  it("drops tags naming a worn or nearby object, including hyphenated compounds", () => {
    for (const t of ["yellow-collar", "collar", "on-a-leash", "red-bandana", "wearing-a-sweater", "handler"]) {
      expect(isDogCharacteristicTag(t)).toBe(false);
    }
  });
});

describe("isPersonFreeDescription (backstop against people leaking into the narrative text)", () => {
  it("rejects descriptions that name a person, in any phrasing", () => {
    for (const s of [
      "A solid black puppy being held up by a person.",
      "The dog sits calmly next to its handler.",
      "A volunteer is petting the dog's head.",
      "Held in someone's hands during the photo.",
      "A staff member stands behind the dog.",
    ]) {
      expect(isPersonFreeDescription(s)).toBe(false);
    }
  });

  it("keeps legitimate dog-only descriptions, including ones using 'held' for posture", () => {
    for (const s of [
      "A scruffy tan dog with a fluffy coat and alert expression.",
      "Her tail is held high and her ears are erect.",
      "A German Shepherd mix with a lean, athletic build.", // "man" inside "German" must not false-positive
    ]) {
      expect(isPersonFreeDescription(s)).toBe(true);
    }
  });
});

describe("vision prompt context", () => {
  it("formats known shelter facts into a grounding line for the model", () => {
    expect(
      formatContextLine({ breed: "dachshund mix", sex: "female", size: "small", ageBucket: "senior" })
    ).toBe("Shelter-reported facts about this dog: breed: dachshund mix, sex: female, age: senior, size: small.");
  });

  it("says so plainly when no shelter facts are known, rather than omitting context", () => {
    expect(formatContextLine({ breed: null, sex: null, size: null, ageBucket: null })).toBe(
      "No shelter-reported facts are available for this dog."
    );
  });

  it("instructs the model to ignore people/objects and use context instead of restating it", () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/ignore any people/i);
    expect(VISION_SYSTEM_PROMPT).toMatch(/collar/i);
    expect(VISION_SYSTEM_PROMPT).toMatch(/do not just restate/i);
    expect(VISION_SYSTEM_PROMPT).toMatch(/never tag a collar/i);
  });
});

describe("enrichment cache selection", () => {
  const listings = [
    { id: "a", primaryPhotoUrl: "https://x/a.jpg", photoHash: "h1" },
    { id: "b", primaryPhotoUrl: "https://x/b.jpg", photoHash: "h2" },
    { id: "c", primaryPhotoUrl: null, photoHash: null },
  ];

  it("skips dogs already analyzed with the same photo, and dogs without photos", () => {
    const existing = new Map([["a", { photoHash: "h1" }]]);
    const { toAnalyze, skippedCached, skippedNoPhoto } = selectCandidates(listings, existing, false);
    expect(toAnalyze.map((c) => c.id)).toEqual(["b"]); // a cached, c no photo
    expect(skippedCached).toBe(1);
    expect(skippedNoPhoto).toBe(1);
  });

  it("re-analyzes when the photo changed, or when forced", () => {
    const staleCache = new Map([["a", { photoHash: "OLD" }]]);
    expect(selectCandidates(listings, staleCache, false).toAnalyze.map((c) => c.id)).toEqual(["a", "b"]);
    const freshCache = new Map([["a", { photoHash: "h1" }]]);
    expect(selectCandidates(listings, freshCache, true).toAnalyze.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
