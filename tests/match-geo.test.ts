import { describe, expect, it } from "vitest";
import { matchListing, type MatchInput, type SearchCriteria } from "@/lib/match";
import { cityCoords, countyCoords, haversineMiles, resolveDogLocation } from "@/lib/geo";

const biscuit: MatchInput = {
  breedNormalized: "dachshund",
  breedRaw: "Dachshund",
  ageMonthsEstimate: 48,
  ageRaw: "4 years",
  sizeNormalized: "small",
  weightLbsEstimate: 16,
  colorsNormalized: ["black", "tan"],
  statusNormalized: "available",
  sex: "female",
  latitude: 37.5629,
  longitude: -122.3255, // San Mateo
};

const sfDoxieSearch: SearchCriteria = {
  breedIncludes: ["dachshund", "doxie"],
  excludePuppies: true,
  sizes: ["small"],
  colors: ["black", "tan"],
  statuses: ["available", "foster", "unknown"],
  center: { latitude: 37.7749, longitude: -122.4194 },
  maxDistanceMiles: 100,
};

describe("deterministic saved-search matching", () => {
  it("matches the demo dachshund search", () => {
    const r = matchListing(biscuit, sfDoxieSearch);
    expect(r.matched).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.reasons.some((x) => x.includes("dachshund"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("mi away"))).toBe(true);
  });

  it("rejects puppies when excluded", () => {
    const r = matchListing({ ...biscuit, ageMonthsEstimate: 6 }, sfDoxieSearch);
    expect(r.matched).toBe(false);
    expect(r.failures).toContain("puppies excluded");
  });

  it("rejects on excluded breed tokens", () => {
    const r = matchListing(biscuit, { breedExcludes: ["dachshund"] });
    expect(r.matched).toBe(false);
  });

  it("treats missing data as unknown, not failure", () => {
    const r = matchListing(
      { ...biscuit, ageMonthsEstimate: null, ageRaw: null, colorsNormalized: [] },
      sfDoxieSearch
    );
    expect(r.matched).toBe(true); // unknowns don't reject
    expect(r.unknowns.length).toBeGreaterThan(0);
  });

  it("rejects outside the distance radius", () => {
    const la = { ...biscuit, latitude: 34.05, longitude: -118.24 };
    const r = matchListing(la, sfDoxieSearch);
    expect(r.matched).toBe(false);
    expect(r.failures.some((f) => f.includes("mi away"))).toBe(true);
  });
});

describe("geo helpers", () => {
  it("haversine SF→LA ≈ 347 miles", () => {
    const d = haversineMiles(37.7749, -122.4194, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });

  it("resolves precision honestly: dog coords > source coords > city > county > unknown", () => {
    const source = {
      latitude: 36.9721,
      longitude: -121.9829,
      geocodePrecision: "campus" as const,
      city: "Santa Cruz",
      county: "Santa Cruz",
    };
    // dog-level coords win
    expect(
      resolveDogLocation({ latitude: 1, longitude: 2, geocodePrecision: "exact_shelter" }, source)
        .precision
    ).toBe("exact_shelter");
    // source campus next
    expect(resolveDogLocation({}, source)).toMatchObject({ precision: "campus" });
    // city fallback
    const noCoords = { ...source, latitude: null, longitude: null };
    expect(resolveDogLocation({ city: "Oakland" }, noCoords).precision).toBe("city");
    // county fallback
    expect(
      resolveDogLocation({ county: "Marin" }, { ...noCoords, city: null, county: null }).precision
    ).toBe("county");
    // unknown when nothing available
    expect(
      resolveDogLocation({}, { latitude: null, longitude: null, geocodePrecision: "unknown", city: "Nowhereville", county: null })
        .precision
    ).toBe("unknown");
  });

  it("city/county lookups are case-insensitive and county strips ' County'", () => {
    expect(cityCoords("SAN FRANCISCO")).not.toBeNull();
    expect(countyCoords("Los Angeles County")).not.toBeNull();
    expect(cityCoords("Not A Real Place")).toBeNull();
  });
});
