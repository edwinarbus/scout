import { describe, expect, it } from "vitest";
import {
  ageBucketFromMonths,
  isPlaceholderName,
  normalizeBreed,
  normalizeColors,
  normalizeName,
  normalizeSex,
  normalizeSize,
  normalizeStatus,
  parseAgeToMonths,
  parseLooseDate,
  parseWeightLbs,
  toIsoDate,
} from "@/lib/normalize";
import { contentHash, hashObject, photoHash, stableStringify } from "@/lib/hash";

const REF = new Date("2026-07-01T00:00:00Z");

describe("normalizeName", () => {
  it("strips shelter decorations and trailing ids", () => {
    expect(normalizeName("PATTIE GONIA* (A332073)")).toBe("Pattie Gonia");
    expect(normalizeName("*BUDDY")).toBe("Buddy");
    expect(normalizeName("  luna  ")).toBe("luna");
    expect(normalizeName("")).toBeNull();
    expect(normalizeName(null)).toBeNull();
  });
  it("flags placeholder/id-style names", () => {
    expect(isPlaceholderName("A5786773")).toBe(true);
    expect(isPlaceholderName("Unknown")).toBe(true);
    expect(isPlaceholderName("Puppy")).toBe(true);
    expect(isPlaceholderName("Biscuit")).toBe(false);
  });
});

describe("parseAgeToMonths", () => {
  it("parses year/month/week combos", () => {
    expect(parseAgeToMonths("2 years", REF).months).toBe(24);
    expect(parseAgeToMonths("2 years 3 months", REF).months).toBe(27);
    expect(parseAgeToMonths("13 weeks old", REF).months).toBe(3);
    expect(parseAgeToMonths("1Yrs 2Mths 1Wks (approx)", REF).months).toBe(14);
    expect(parseAgeToMonths("Est. age: 14 yrs", REF).months).toBe(168);
    expect(parseAgeToMonths("The shelter staff think I am about 11 years old.", REF).months).toBe(132);
  });
  it("handles buckets, unknowns, and artifacts", () => {
    expect(parseAgeToMonths("Senior", REF)).toEqual({ months: null, bucket: "senior" });
    expect(parseAgeToMonths("puppy", REF).bucket).toBe("puppy");
    expect(parseAgeToMonths(null, REF).months).toBeNull();
    expect(parseAgeToMonths("0 years 0 months", REF).months).toBeNull(); // data artifact
    expect(parseAgeToMonths("gibberish", REF)).toEqual({ months: null, bucket: null });
  });
  it("computes from DOB against the reference date", () => {
    expect(parseAgeToMonths("DOB 2025-07-01", REF).months).toBe(12);
  });
  it("buckets correctly", () => {
    expect(ageBucketFromMonths(3)).toBe("puppy");
    expect(ageBucketFromMonths(18)).toBe("young");
    expect(ageBucketFromMonths(60)).toBe("adult");
    expect(ageBucketFromMonths(132)).toBe("senior");
    expect(ageBucketFromMonths(null)).toBeNull();
  });
});

describe("normalizeSex", () => {
  it("detects sex and altered status", () => {
    expect(normalizeSex("Neutered Male")).toEqual({ sex: "male", spayedNeutered: true });
    expect(normalizeSex("Spayed Female")).toEqual({ sex: "female", spayedNeutered: true });
    expect(normalizeSex("Female")).toEqual({ sex: "female", spayedNeutered: null });
    expect(normalizeSex("intact male")).toEqual({ sex: "male", spayedNeutered: false });
    expect(normalizeSex(null)).toEqual({ sex: "unknown", spayedNeutered: null });
  });
});

describe("weight & size", () => {
  it("parses weights in lbs and kg", () => {
    expect(parseWeightLbs("15.50 Lbs")).toBe(15.5);
    expect(parseWeightLbs("45 pounds")).toBe(45);
    expect(parseWeightLbs("20 kg")).toBeCloseTo(44.1, 1);
    expect(parseWeightLbs(null)).toBeNull();
  });
  it("normalizes sizes with weight fallback", () => {
    expect(normalizeSize("X-Large")).toBe("xlarge");
    expect(normalizeSize("MED")).toBe("medium");
    expect(normalizeSize(null, 12)).toBe("small");
    expect(normalizeSize("PUPPY", 70)).toBe("large"); // size-class word falls through to weight
    expect(normalizeSize(null, null)).toBeNull();
  });
});

describe("normalizeBreed", () => {
  it("splits multi-breed strings and applies aliases", () => {
    const r = normalizeBreed("Labrador Retriever and Belgian Malinois");
    expect(r.tokens).toEqual(["labrador retriever", "belgian malinois"]);
    expect(r.isMix).toBe(true);
    expect(normalizeBreed("GERM SHEPHERD").tokens).toEqual(["german shepherd"]);
    expect(normalizeBreed("Pit Bull Terrier").tokens).toEqual(["pit bull"]);
    expect(normalizeBreed("Terrier Mix").normalized).toBe("terrier mix");
    expect(normalizeBreed(null).normalized).toBeNull();
  });
});

describe("normalizeColors", () => {
  it("splits and aliases colors", () => {
    expect(normalizeColors("BLACK/WHITE")).toEqual(["black", "white"]);
    expect(normalizeColors("tan and white")).toEqual(["tan", "white"]);
    expect(normalizeColors("Blk / Brn")).toEqual(["black", "brown"]);
    expect(normalizeColors(null)).toEqual([]);
  });
});

describe("normalizeStatus", () => {
  it("maps the DACC/24pc status vocabulary and preserves unknowns as unknown", () => {
    expect(normalizeStatus("ADOPTION PENDING")).toBe("pending");
    expect(normalizeStatus("AV PEND SN (Available - pending spay/neuter)")).toBe("pending");
    expect(normalizeStatus("STRAY WAIT")).toBe("stray_hold");
    expect(normalizeStatus("RESCUE ONLY")).toBe("rescue_only");
    expect(normalizeStatus("ID HOLD")).toBe("hold");
    expect(normalizeStatus("OTHER HOLD")).toBe("hold");
    expect(normalizeStatus("RTGH")).toBe("available");
    expect(normalizeStatus("adopt")).toBe("available"); // 24pc adoptable-list view type
    expect(normalizeStatus("Available")).toBe("available");
    expect(normalizeStatus("In Foster - Available")).toBe("foster");
    expect(normalizeStatus("Medical Hold")).toBe("medical_hold");
    expect(normalizeStatus("adopted")).toBe("adopted");
    expect(normalizeStatus("")).toBe("unknown");
    expect(normalizeStatus("XYZZY")).toBe("unknown");
  });
});

describe("dates", () => {
  it("parses loose US dates", () => {
    expect(toIsoDate(parseLooseDate("Jun 27, 2026"))).toBe("2026-06-27");
    expect(toIsoDate(parseLooseDate("6/27/2026"))).toBe("2026-06-27");
    expect(toIsoDate(parseLooseDate("2026-06-27"))).toBe("2026-06-27");
    expect(parseLooseDate("13/45/2026")).toBeNull();
  });
});

describe("hashing", () => {
  it("is stable across key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [{ c: 3, d: 2 }], b: 1 })
    );
    expect(hashObject({ x: 1, y: 2 })).toBe(hashObject({ y: 2, x: 1 }));
  });
  it("changes when content changes", () => {
    expect(contentHash({ name: "Rex" })).not.toBe(contentHash({ name: "Rexy" }));
  });
  it("hashes photo sets order-independently", () => {
    expect(photoHash(["b.jpg", "a.jpg"])).toBe(photoHash(["a.jpg", "b.jpg"]));
    expect(photoHash([])).toBeNull();
  });
});
