import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import {
  extractBio,
  parseDescriptionSentence,
  parseDetailPage,
  parseIntakeDate,
} from "@/adapters/petconnect24";
import { mapDaccAnimal, photoUrlsFor, type DaccAnimal } from "@/adapters/lacdacc";
import {
  dedupePhotoVariants,
  parseDetail as parseMuttvilleDetail,
  parseFactsBlock,
  parseListingCards,
} from "@/adapters/muttville";
import { parseAnimalDetail, parseSearchResults } from "@/adapters/shelterbuddy";
import { MOCK_DOGS } from "@/adapters/mock";

const fixture = (...p: string[]) =>
  fs.readFileSync(path.join(__dirname, "..", "src", "adapters", "__fixtures__", ...p), "utf8");

describe("24Petconnect adapter (recorded fixtures)", () => {
  it("parses the listing grid: 17 cards with ids, names, breeds, photos", () => {
    const html = fixture("petconnect24", "list_santacruz.html");
    // count header
    expect(html).toMatch(/Animals:\s*1\s*-\s*17\s*of\s*17/);
    const $ = cheerio.load(html);
    const cards = $(".gridResult");
    expect(cards.length).toBe(17);
    const first = cards.first();
    expect(first.attr("onclick")).toContain("Details('SantaCruzAdoptable', 'SNCR', 'A332073')");
    expect(first.find(".text_Name").text()).toContain("PATTIE GONIA");
    expect(first.find(".text_Breed").text()).toContain("Labrador Retriever");
  });

  it("parses the detail page: description, age, intake, shelter contact, photos", () => {
    const d = parseDetailPage(fixture("petconnect24", "detail_A332073.html"), "https://24petconnect.com");
    expect(d.descriptionSentence).toContain("spayed female");
    expect(d.ageSentence).toContain("13 weeks");
    expect(d.shelterPhone).toBe("(831) 454-7200");
    expect(d.shelterAddress).toContain("1001 Rodriguez Street");
    expect(d.shelterWebsite).toContain("scanimalshelter.org");
    expect(d.photoUrls.length).toBeGreaterThan(0);
    expect(d.photoUrls[0]).toMatch(/^https:\/\/24petconnect\.com\/image\/\d+/);
    expect(parseIntakeDate(d.moreInfo)).toBe("2026-06-27");
    expect(extractBio(d.moreInfo)).toContain("Pattie Gonia of our Lab mix");
  });

  it("extracts sex/altered/color from the description sentence", () => {
    const r = parseDescriptionSentence(
      "My name is Pattie Gonia* and I am a spayed female,  black Labrador Retriever and Belgian Malinois.",
      "Labrador Retriever and Belgian Malinois"
    );
    expect(r.sexRaw).toBe("spayed female");
    expect(r.colorRaw).toBe("black");
    expect(parseDescriptionSentence(null, null)).toEqual({
      sexRaw: null,
      colorRaw: null,
      breedFromSentence: null,
    });
  });

  it("splits color/breed from the sentence when the tenant hides the breed column", () => {
    const r = parseDescriptionSentence(
      "My name is Bijou and I am a spayed female, tan and white Siberian Husky.",
      null
    );
    expect(r.colorRaw).toBe("tan and white");
    expect(r.breedFromSentence).toBe("Siberian Husky");
    // no leading color words → all breed
    const r2 = parseDescriptionSentence("I am a neutered male, Poodle mix.", null);
    expect(r2.breedFromSentence).toBe("Poodle mix");
    expect(r2.colorRaw).toBeNull();
  });
});

describe("LA County DACC adapter (recorded API fixture)", () => {
  const page = JSON.parse(fixture("lacdacc", "animals_page1.json")) as {
    totalRecords: number;
    animals: DaccAnimal[];
  };

  it("fixture reports totals for pagination auditing", () => {
    expect(page.totalRecords).toBeGreaterThan(500);
    expect(page.animals.length).toBeGreaterThan(0);
  });

  it("maps an API animal to an extraction with preserved statuses", () => {
    const cleo = page.animals.find((a) => a.animalId === "A5768901")!;
    const dog = mapDaccAnimal(cleo, "https://animalcare.lacounty.gov");
    expect(dog.name).toBe("CLEO");
    expect(dog.statusRaw).toContain("AV PEND SN"); // raw kennel status preserved
    expect(dog.originalUrl).toBe(
      "https://animalcare.lacounty.gov/dacc-details/?animalId=A5768901"
    );
    expect(dog.ageRaw).toBe("5 months");
    expect(dog.weightRaw).toBe("30.5 lbs");
    expect(dog.shelterName).toContain("Agoura");
    expect(dog.latitude).not.toBeNull();
    expect(dog.geocodePrecision).toBe("campus");
    expect(dog.photoUrls).toHaveLength(3);
    expect(dog.rawPayload.api).toBeTruthy();
  });

  it("builds -2/-3 photo variants from imageCount", () => {
    expect(photoUrlsFor("A1", 3)).toEqual([
      "https://daccanimalimagesprod.blob.core.windows.net/images/A1.jpg",
      "https://daccanimalimagesprod.blob.core.windows.net/images/A1-2.jpg",
      "https://daccanimalimagesprod.blob.core.windows.net/images/A1-3.jpg",
    ]);
    expect(photoUrlsFor("A1", null)).toHaveLength(1);
    // 0 is the source explicitly saying "no photo" — must not fabricate one.
    expect(photoUrlsFor("A1", 0)).toEqual([]);
  });

  it("dogs with imageCount 0 get no primary photo (never a guessed, dead URL)", () => {
    const noPhoto: DaccAnimal = {
      ...page.animals[0],
      animalId: "A9999999",
      imageCount: 0,
    };
    const dog = mapDaccAnimal(noPhoto, "https://animalcare.lacounty.gov");
    expect(dog.primaryPhotoUrl).toBeNull();
    expect(dog.photoUrls).toEqual([]);
  });

  it("preserves hold notes and rescue-only flags without inventing status", () => {
    const stray = page.animals.find((a) => a.kennelStat === "STRAY WAIT");
    if (stray) {
      const dog = mapDaccAnimal(stray, "https://x");
      expect(dog.holdNotes).toContain("Stray wait");
    }
  });
});

describe("Muttville adapter (recorded fixtures)", () => {
  it("parses all listing cards from the single-page list", () => {
    const cards = parseListingCards(fixture("muttville", "list.html"), "https://muttville.org");
    expect(cards.length).toBe(51);
    expect(cards[0]).toMatchObject({ slug: "union-14104", name: "Union" });
    expect(cards[0].photoUrl).toContain("muttville-media");
  });

  it("parses the facts block", () => {
    const f = parseFactsBlock("#14104\nChihuahua\nMale\n9 lbs (small)\nEst. age: 14 yrs\nStatus: Available");
    expect(f).toMatchObject({
      animalId: "14104",
      breedRaw: "Chihuahua",
      sexRaw: "Male",
      weightRaw: "9 lbs",
      sizeRaw: "small",
      ageRaw: "14 yrs",
      statusRaw: "Available",
    });
  });

  it("parses the detail page: name, facts, bio, deduped photos", () => {
    const d = parseMuttvilleDetail(fixture("muttville", "detail_union.html"), "https://muttville.org");
    expect(d.name).toBe("Union");
    expect(d.facts.animalId).toBe("14104");
    expect(d.facts.statusRaw).toBe("Available");
    expect(d.bio).toContain("street fair");
    expect(d.photoUrls.length).toBeGreaterThan(0);
    // variants collapsed: no -med duplicates of the same photo id
    const ids = d.photoUrls.map((u) => u.match(/(\d+-\d+)-(?:lg|med)/)?.[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dedupes photo size variants preferring -lg", () => {
    const urls = dedupePhotoVariants([
      "https://x/images/mutts/1/115597-100005-med.jpg",
      "https://x/images/mutts/1/115597-100005-lg.jpg",
      "https://x/images/mutts/1/115597-100001-med.jpg",
    ]);
    expect(urls).toContain("https://x/images/mutts/1/115597-100005-lg.jpg");
    expect(urls).toHaveLength(2);
  });
});

describe("ShelterBuddy adapter (recorded fixtures)", () => {
  it("parses search result cards with pagination-safe dedupe", () => {
    const cards = parseSearchResults(
      fixture("shelterbuddy", "results_marin.html"),
      "https://marinpets.shelterbuddy.com"
    );
    expect(cards.length).toBe(15);
    const charlotte = cards.find((c) => c.animalId === "43723")!;
    expect(charlotte.name).toBe("Charlotte");
    expect(charlotte.breedLine).toContain("German Shepherd");
    expect(charlotte.desexed).toBe(true);
    expect(charlotte.sexAgeLine).toMatch(/^Female - 1Yrs/);
  });

  it("parses the animal detail: fields, suitability (presence=true, absence=null), bio", () => {
    const d = parseAnimalDetail(
      fixture("shelterbuddy", "detail_43723.html"),
      "https://marinpets.shelterbuddy.com"
    );
    expect(d.fields["Breed"]).toContain("German Shepherd");
    expect(d.fields["Second Breed"]).toContain("Doberman");
    expect(d.fields["Sex"]).toBe("Female");
    expect(d.fields["Weight"]).toContain("50.2");
    expect(d.fields["Size"]).toBe("Medium");
    expect(d.okWithCats).toBe(true);
    expect(d.okWithDogs).toBe(true);
    expect(d.vaccinated).toBe(true);
    expect(d.microchipped).toBe(true);
    expect(d.bio).toContain("Charlotte");
    expect(d.contactPhone).toContain("415");
  });
});

describe("mock adapter data", () => {
  it("exercises the edge cases the UI must tolerate", () => {
    expect(MOCK_DOGS.length).toBeGreaterThanOrEqual(12);
    expect(MOCK_DOGS.some((d) => d.photoUrls.length === 0)).toBe(true); // no photo
    expect(MOCK_DOGS.some((d) => d.primaryPhotoUrl?.includes(".invalid"))).toBe(true); // broken photo
    expect(MOCK_DOGS.some((d) => d.photoUrls.length >= 3)).toBe(true); // multi-photo
    expect(MOCK_DOGS.some((d) => !d.latitude && !d.city)).toBe(true); // no location
    expect(MOCK_DOGS.some((d) => d.statusRaw === "" || d.statusRaw == null)).toBe(true); // unknown status
    expect(MOCK_DOGS.some((d) => d.fosterNotes)).toBe(true);
    expect(MOCK_DOGS.some((d) => d.holdNotes)).toBe(true);
    expect(MOCK_DOGS.some((d) => d.contactEmail)).toBe(true); // contact override
  });
});
