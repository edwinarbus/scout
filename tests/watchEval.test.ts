import { describe, it, expect } from "vitest";
import type { DogView } from "@/lib/dogView";
import type { SearchMatch } from "@/lib/aiSearch";
import { buildAiIndex, selectNewMatches } from "@/lib/watchEval";

/** Minimal SearchMatch factory — only the fields selectNewMatches reads. */
function match(
  id: string,
  opts: Partial<{
    score: number;
    photo: boolean;
    status: DogView["statusNormalized"];
    freshness: DogView["freshness"];
  }> = {}
): SearchMatch {
  const { score = 5, photo = true, status = "available", freshness = "fresh" } = opts;
  const dog = {
    id,
    name: id,
    primaryPhotoUrl: photo ? `https://img/${id}.jpg` : null,
    statusNormalized: status,
    freshness,
  } as unknown as DogView;
  return { dog, score, reasons: [], unknowns: [] };
}

describe("selectNewMatches", () => {
  it("skips dogs already notified for the watch", () => {
    const matches = [match("a"), match("b"), match("c")];
    const out = selectNewMatches(matches, { alreadyNotified: new Set(["b"]) });
    expect(out.map((m) => m.dog.id)).toEqual(["a", "c"]);
  });

  it("requires a photo and adoptable status by default", () => {
    const matches = [
      match("has-photo"),
      match("no-photo", { photo: false }),
      match("pending", { status: "pending" }),
      match("missing", { freshness: "missing" }),
    ];
    const out = selectNewMatches(matches, { alreadyNotified: new Set() });
    expect(out.map((m) => m.dog.id)).toEqual(["has-photo"]);
  });

  it("honors availableOnly / requirePhoto overrides", () => {
    const matches = [match("no-photo", { photo: false }), match("pending", { status: "pending" })];
    const out = selectNewMatches(matches, {
      alreadyNotified: new Set(),
      availableOnly: false,
      requirePhoto: false,
    });
    expect(out.map((m) => m.dog.id)).toEqual(["no-photo", "pending"]);
  });

  it("applies a minimum score floor", () => {
    const matches = [match("weak", { score: 1 }), match("strong", { score: 9 })];
    const out = selectNewMatches(matches, { alreadyNotified: new Set(), minScore: 5 });
    expect(out.map((m) => m.dog.id)).toEqual(["strong"]);
  });

  it("caps the number of alerts per run", () => {
    const matches = Array.from({ length: 20 }, (_, i) => match(`d${i}`));
    const out = selectNewMatches(matches, { alreadyNotified: new Set(), limit: 3 });
    expect(out).toHaveLength(3);
  });

  it("preserves the ranked order it was given", () => {
    const matches = [match("first", { score: 10 }), match("second", { score: 8 })];
    const out = selectNewMatches(matches, { alreadyNotified: new Set() });
    expect(out.map((m) => m.dog.id)).toEqual(["first", "second"]);
  });
});

describe("buildAiIndex", () => {
  it("indexes only dogs that have an AI photo read", () => {
    const dogs = [
      { id: "with-ai", ai: { tags: ["scruffy"], coatTexture: "wiry", coatLength: "medium", apparentSize: "small", visualDescription: "a scruffy little dog" } },
      { id: "no-ai", ai: null },
    ] as unknown as DogView[];
    const idx = buildAiIndex(dogs);
    expect(idx.has("with-ai")).toBe(true);
    expect(idx.has("no-ai")).toBe(false);
    expect(idx.get("with-ai")?.tags).toEqual(["scruffy"]);
  });
});
