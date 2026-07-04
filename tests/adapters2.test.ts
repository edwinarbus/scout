import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseListingPage as parseLaasList, parseDetailPage as parseLaasDetail } from "@/adapters/laas";
import { mapSdhsAnimal, iconsToFlags, type SdhsAnimal } from "@/adapters/sdhumane";
import {
  animalIdFromPermalink,
  parseDetailPage as parseSfspcaDetail,
} from "@/adapters/sfspca";
import {
  parseListingPage as parseOaklandList,
  parseDetailPage as parseOaklandDetail,
} from "@/adapters/oakland";
import { mapAdopetsPet } from "@/adapters/adopets";
import {
  mapShelterluvAnimal,
  orderedPhotoUrls,
  parseAnimalDetailPage,
  type ShelterluvAnimal,
} from "@/adapters/shelterluv";
import { parseAgeToMonths } from "@/lib/normalize";

const fixture = (...p: string[]) =>
  fs.readFileSync(path.join(__dirname, "..", "src", "adapters", "__fixtures__", ...p), "utf8");

describe("LAAS adapter (priority 1, recorded fixtures)", () => {
  it("parses listing cards with animal IDs, names, PetHarbor photos", () => {
    const { cards, lastPage, hasNext } = parseLaasList(
      fixture("laas", "list_page1.html"),
      "https://www.laanimalservices.com"
    );
    expect(cards.length).toBe(24); // Drupal pager page size
    expect(lastPage).toBe(30); // 31 pages advertised
    expect(hasNext).toBe(true);
    const first = cards.find((c) => c.animalId === "A2282226")!;
    expect(first.name).toBe("Big Fella");
    expect(first.petPath).toBe("/pet/a2282226");
    expect(first.photoUrl).toContain("petharbor.com");
    // every card must have a stable dedupe key
    expect(cards.every((c) => c.animalId)).toBe(true);
  });

  it("parses detail pages: fields, shelter location + address", () => {
    const d = parseLaasDetail(
      fixture("laas", "detail_a2282226.html"),
      "https://www.laanimalservices.com"
    );
    expect(d.fields["Animal ID"]).toBe("A2282226");
    expect(d.fields["Sex"]).toBe("Neutered Male");
    expect(d.fields["Breed"]).toContain("Staffordshire");
    expect(d.fields["Color"]).toBe("Blue");
    expect(d.fields["Size"]).toBe("Large");
    expect(d.fields["Care Status"]).toBe("In Shelter");
    expect(d.locationName).toBe("West Valley");
    expect(d.locationAddress).toContain("Chatsworth");
    // LAAS has no narrative bio; the .pet-details__others "You may also like…"
    // related-dogs widget must NOT leak into the biography.
    expect(d.bio).toBeNull();
  });

  it("parses LAAS lifestage strings honestly", () => {
    expect(parseAgeToMonths("Senior Dog: 7+ yrs.")).toEqual({ months: 84, bucket: "senior" });
    expect(parseAgeToMonths("Puppy: Under 1 yr.")).toEqual({ months: null, bucket: "puppy" });
    const young = parseAgeToMonths("Young Adult: 1-3 yrs.");
    expect(young.months).toBe(24);
    expect(young.bucket).toBe("young");
  });
});

describe("San Diego Humane adapter (priority 2, recorded feed fixture)", () => {
  const payload = JSON.parse(fixture("sdhumane", "search_trimmed.json")) as {
    response: SdhsAnimal[];
  };

  it("maps feed records with campus, status, structured age/breed", () => {
    const dog = payload.response.find((a) => a.AnimalType === "Dog")!;
    const mapped = mapSdhsAnimal(dog, "https://sdhumane.org");
    expect(mapped.sourceAnimalId).toBe(String(dog.AnimalId));
    expect(mapped.originalUrl).toBe(
      `https://sdhumane.org/adopt/available-pets/animal-single?petId=${dog.AnimalId}`
    );
    expect(mapped.name).toBeTruthy();
    expect(mapped.breedRaw).toBeTruthy();
    expect(mapped.statusRaw).toContain("Available");
    expect(mapped.geocodePrecision).toBe("campus");
    expect(mapped.photoUrls[0]).toMatch(/^https:\/\/sdhumane\.shelterbuddy\.com\/storage/);
    expect(mapped.rawPayload.api).toBeTruthy();
  });

  it("keeps cats out (adapter filters species) and maps icon flags without guessing", () => {
    expect(payload.response.some((a) => a.AnimalType === "Cat")).toBe(true); // fixture includes cats
    expect(iconsToFlags(["Has Done Well with Kids", "Only Dog Home", null])).toEqual({
      goodWithKids: true,
      goodWithDogs: false,
      goodWithCats: null,
    });
    expect(iconsToFlags([null, null, null])).toEqual({
      goodWithKids: null,
      goodWithDogs: null,
      goodWithCats: null,
    });
  });
});

describe("SF SPCA adapter (priority 4, recorded fixtures)", () => {
  it("extracts animal ids from permalinks", () => {
    expect(animalIdFromPermalink("https://www.sfspca.org/sfspca-adoption/61296408/")).toBe(
      "61296408"
    );
    expect(animalIdFromPermalink(null)).toBeNull();
  });

  it("parses the adoption API page fixture", () => {
    const page = JSON.parse(fixture("sfspca", "adoption_page0.json"));
    expect(page.pagination.maxPages).toBeGreaterThan(0);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0].permalink).toContain("/sfspca-adoption/");
    expect(page.items[0].tags.species).toBeTruthy();
  });

  it("parses detail pages for age/weight/bio", () => {
    const d = parseSfspcaDetail(fixture("sfspca", "detail_61296408.html"));
    expect(d.ageRaw).toBe("3 m");
    expect(d.weightRaw).toContain("3 lbs");
    expect(d.bio).toBeTruthy();
  });
});

describe("Oakland adapter (priority 5, recorded fixtures)", () => {
  it("parses every animalCell with data attributes", () => {
    const cards = parseOaklandList(
      fixture("oakland", "list.html"),
      "https://www.oaklandanimalservices.org"
    );
    expect(cards.length).toBeGreaterThan(50);
    const paloma = cards.find((c) => c.identifier === "18071751")!;
    expect(paloma.name).toBe("Paloma");
    expect(paloma.sex).toBe("Female");
    expect(paloma.weight).toBe("47.0");
    expect(paloma.location).toBe("Foster");
    expect(paloma.intake).toBe("01/31/2022");
    expect(paloma.photoUrl).toContain("cdn.rescuegroups.org");
    expect(cards.every((c) => c.identifier)).toBe(true); // stable keys everywhere
  });

  it("parses detail pages: full breed, health flags, photos", () => {
    const d = parseOaklandDetail(fixture("oakland", "detail_18071751.html"));
    expect(d.fields["Breed"]).toContain("Australian Cattle Dog");
    expect(d.fields["Color"]).toBe("White");
    expect(d.fields["Spayed/Neutered"]).toBe("Yes");
    expect(d.photoUrls.length).toBeGreaterThan(1);
  });
});

describe("Adopets adapter (priority 6, recorded API fixture)", () => {
  it("maps pet/find records (nested under organization_pet)", () => {
    const item = JSON.parse(fixture("adopets", "pet_sample.json"));
    const pet = item.organization_pet ?? item;
    const mapped = mapAdopetsPet(pet);
    expect(mapped.sourceAnimalId).toBe("A691783");
    expect(mapped.originalUrl).toBe(`https://adopt.adopets.com/pet/${pet.uuid}`);
    expect(mapped.name).toBe("Koda");
    expect(mapped.breedRaw).toContain("German Shepherd");
    expect(mapped.weightRaw).toBe("36.00 lbs");
    expect(mapped.adoptionFee).toBe("$91.00");
    expect(mapped.statusRaw).toBe("available");
    // age_number is days → months estimate
    expect(parseAgeToMonths(mapped.ageRaw!).months).toBe(Math.round(2638 / 30.44));
  });
});

describe("ShelterLuv adapter (Rocket Dog family, recorded feed fixture)", () => {
  const payload = JSON.parse(fixture("shelterluv", "available_184.json")) as {
    animals: ShelterluvAnimal[];
  };

  it("maps feed records with stable uniqueId key, DOB-derived age, public_url", () => {
    const a = payload.animals.find((x) => x.uniqueId === "RCKT-A-6052")!;
    const mapped = mapShelterluvAnimal(a, "https://new.shelterluv.com");
    expect(mapped.sourceAnimalId).toBe("RCKT-A-6052"); // stable, org-scoped key
    expect(mapped.originalUrl).toBe("https://new.shelterluv.com/embed/animal/206030899");
    expect(mapped.name).toBe("Atlantis");
    expect(mapped.breedRaw).toContain("Mixed Breed");
    expect(mapped.colorRaw).toBe("Brindle / Brown");
    expect(mapped.sizeRaw).toContain("Medium"); // weight_group → size
    expect(mapped.statusRaw).toBe("Available");
    expect(mapped.fosterNotes).toMatch(/foster/i); // location "Foster Home"
    expect(mapped.photoUrls.length).toBeGreaterThan(0);
    // birthday 1684625393 → 2023-05-20 → stable DOB string, real age estimate
    expect(mapped.ageRaw).toBe("DOB 2023-05-20");
    expect(parseAgeToMonths(mapped.ageRaw!).months).toBeGreaterThan(12);
    expect(mapped.rawPayload.api).toBeTruthy();
  });

  it("orders photos cover-first and drops placeholders", () => {
    const photos = {
      "0": { url: "https://x/a.jpg", isCover: false, order_column: 3 },
      "1": { url: "https://x/cover.jpg", isCover: true, order_column: 1 },
      "2": { url: "https://x/img/profile_photo/default_animal.png", isCover: false, order_column: 2 },
    };
    const urls = orderedPhotoUrls(photos);
    expect(urls[0]).toBe("https://x/cover.jpg"); // cover first
    expect(urls).not.toContain("https://x/img/profile_photo/default_animal.png"); // placeholder dropped
    expect(orderedPhotoUrls(null)).toEqual([]);
  });

  it("every fixture dog has a stable dedupe key and a species of Dog", () => {
    const dogs = payload.animals.filter((a) => (a.species ?? "").toLowerCase() === "dog");
    for (const a of dogs) {
      const m = mapShelterluvAnimal(a, "https://new.shelterluv.com");
      expect(m.sourceAnimalId).toBeTruthy();
      expect(m.originalUrl).toContain("shelterluv.com");
    }
  });

  // The list feed above has NO bio field at all — it only exists on the
  // per-animal embed page, HTML-attribute-encoded onto <iframe-animal :animal="…">.
  it("pulls the bio (kennel_description) out of the per-animal embed page", () => {
    const html = fixture("shelterluv", "detail_213244792.html");
    const { kennelDescription } = parseAnimalDetailPage(html);
    expect(kennelDescription).toContain("Jaxon is a sweet dog");
    expect(kennelDescription).toContain("He pulls on the leash");
    expect(kennelDescription).toContain("Jaxon weighs 22 pounds");
    // the entity-encoded apostrophe and <br> tags must come out clean, not raw
    expect(kennelDescription).toContain("who's good");
    expect(kennelDescription).not.toMatch(/<br|&#0?39;|&amp;/);
    // this source stores a literal newline ALONGSIDE its <br> for the same
    // line wrap (an authoring artifact) — naively doubling both into \n\n
    // landed a paragraph break mid-sentence, splitting "other" from "dogs".
    // It must read as one continuous sentence, not two paragraphs.
    expect(kennelDescription).toContain("experience around other dogs");
    expect(kennelDescription).not.toMatch(/other\n/);
  });

  it("returns a null bio when the page has no iframe-animal element", () => {
    expect(parseAnimalDetailPage("<html><body>not a shelterluv page</body></html>").kennelDescription).toBeNull();
  });
});
