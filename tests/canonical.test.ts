import { describe, expect, it } from "vitest";
import { buildCanonicalGroups, type CanonicalInput } from "@/lib/canonical";

const base = (over: Partial<CanonicalInput> & { id: string; sourceId: string }): CanonicalInput => ({
  name: "Rex",
  sex: "male",
  breedTokens: ["labrador retriever"],
  ageMonthsEstimate: 36,
  primaryPhotoUrl: null,
  lastSeenAt: new Date("2026-07-01"),
  hasPhoto: true,
  bioLength: 100,
  isActive: true,
  ...over,
});

describe("canonical dedupe (over-dedupe by policy)", () => {
  it("merges cross-source listings with same name/sex/breed", () => {
    const groups = buildCanonicalGroups([
      base({ id: "a", sourceId: "s1" }),
      base({ id: "b", sourceId: "s2" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].listingIds).toEqual(["a", "b"]);
  });

  it("merges when one side's breed is unknown (unsure → merge)", () => {
    const groups = buildCanonicalGroups([
      base({ id: "a", sourceId: "s1" }),
      base({ id: "b", sourceId: "s2", breedTokens: [] }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("does NOT merge different sexes or disjoint breeds", () => {
    expect(
      buildCanonicalGroups([
        base({ id: "a", sourceId: "s1", sex: "male" }),
        base({ id: "b", sourceId: "s2", sex: "female" }),
      ])
    ).toHaveLength(2);
    expect(
      buildCanonicalGroups([
        base({ id: "a", sourceId: "s1", breedTokens: ["chihuahua"] }),
        base({ id: "b", sourceId: "s2", breedTokens: ["husky"] }),
      ])
    ).toHaveLength(2);
  });

  it("never merges placeholder/id-style names across sources", () => {
    const groups = buildCanonicalGroups([
      base({ id: "a", sourceId: "s1", name: "A5786773" }),
      base({ id: "b", sourceId: "s2", name: "A5786773" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("merges same-source relistings (same dog, new id) via name+sex+breed", () => {
    const groups = buildCanonicalGroups([
      base({ id: "s1::100", sourceId: "s1" }),
      base({ id: "s1::200", sourceId: "s1" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("merges on identical photo URL regardless of name", () => {
    const groups = buildCanonicalGroups([
      base({ id: "a", sourceId: "s1", name: "Rex", primaryPhotoUrl: "https://x/1.jpg" }),
      base({ id: "b", sourceId: "s2", name: "Rexy", primaryPhotoUrl: "https://x/1.jpg" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("never merges through placeholder or mass-shared photo URLs", () => {
    // filename says placeholder
    const placeholder = "https://x/themes/images/pet-details__no-image-generic.svg";
    expect(
      buildCanonicalGroups([
        base({ id: "a", sourceId: "s1", name: "Ford", breedTokens: ["boxer"], primaryPhotoUrl: placeholder }),
        base({ id: "b", sourceId: "s1", name: "Papa", breedTokens: ["husky"], primaryPhotoUrl: placeholder }),
      ])
    ).toHaveLength(2);
    // shared by 3+ listings = statistical placeholder, whatever the filename
    const shared = "https://x/photos/mystery.jpg";
    const groups = buildCanonicalGroups([
      base({ id: "a", sourceId: "s1", name: "Uno", breedTokens: ["boxer"], primaryPhotoUrl: shared }),
      base({ id: "b", sourceId: "s2", name: "Dos", breedTokens: ["husky"], primaryPhotoUrl: shared }),
      base({ id: "c", sourceId: "s3", name: "Tres", breedTokens: ["poodle"], primaryPhotoUrl: shared }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("does not merge incompatible ages cross-source", () => {
    const groups = buildCanonicalGroups([
      base({ id: "a", sourceId: "s1", ageMonthsEstimate: 6 }),
      base({ id: "b", sourceId: "s2", ageMonthsEstimate: 120 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("picks the best display listing: active > photo > longer bio > newest", () => {
    const groups = buildCanonicalGroups([
      base({ id: "stale", sourceId: "s1", isActive: false, bioLength: 999 }),
      base({ id: "fresh-nophoto", sourceId: "s2", hasPhoto: false }),
      base({ id: "fresh-photo", sourceId: "s3" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].displayListingId).toBe("fresh-photo");
  });
});
