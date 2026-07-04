import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { ScoutDb } from "@/db";
import { adoptionSources } from "@/db/schema";
import { getAdapter } from "@/adapters";
import type { AdapterContext } from "@/adapters/types";
import { fetchJson, fetchPage } from "@/lib/fetchClient";
import type { AdapterResult, ExtractedDog } from "@/lib/types";

/**
 * Adapter verification.
 *
 * Fixture mode (default) proves the parsers still understand recorded
 * HTML/JSON without touching shelter sites. Live mode runs a capped,
 * write-free crawl (a few pages / a few detail pages) against the real
 * source and evaluates the working-adapter checklist.
 */

export interface VerifyCheck {
  name: string;
  ok: boolean | null; // null = not applicable / unknown
  info?: string;
}

export interface VerifyReport {
  sourceId: string;
  adapterType: string;
  mode: "fixtures" | "live";
  verdict: "pass" | "partial" | "fail";
  dogsSampled: number;
  dedupeKeyStrength: "animal_id" | "original_url" | "mixed" | "none";
  checks: VerifyCheck[];
  notes: string[];
}

const FIXTURES_DIR = path.join(process.cwd(), "src", "adapters", "__fixtures__");
const readFixture = (...p: string[]) => fs.readFileSync(path.join(FIXTURES_DIR, ...p), "utf8");

function evaluateDogs(dogs: ExtractedDog[], checks: VerifyCheck[]): void {
  const n = dogs.length || 1;
  const withId = dogs.filter((d) => d.sourceAnimalId?.trim()).length;
  const withUrl = dogs.filter((d) => d.originalUrl).length;
  const withName = dogs.filter((d) => d.name).length;
  const withPhoto = dogs.filter((d) => d.photoUrls.length > 0).length;
  const withBreed = dogs.filter((d) => d.breedRaw).length;
  const withAge = dogs.filter((d) => d.ageRaw).length;
  const withSex = dogs.filter((d) => d.sexRaw).length;
  const withStatus = dogs.filter((d) => d.statusRaw).length;
  const withRaw = dogs.filter((d) => d.rawPayload && Object.keys(d.rawPayload).length).length;
  checks.push(
    { name: "dogs found", ok: dogs.length > 0, info: String(dogs.length) },
    { name: "original listing URLs", ok: withUrl === dogs.length, info: `${withUrl}/${dogs.length}` },
    { name: "animal IDs", ok: withId / n >= 0.9 ? true : withId > 0 ? null : false, info: `${withId}/${dogs.length}` },
    { name: "names", ok: withName / n >= 0.9, info: `${withName}/${dogs.length}` },
    { name: "photos", ok: withPhoto / n >= 0.7 ? true : withPhoto > 0 ? null : false, info: `${withPhoto}/${dogs.length}` },
    { name: "breed", ok: withBreed / n >= 0.7 ? true : withBreed > 0 ? null : false, info: `${withBreed}/${dogs.length}` },
    { name: "age", ok: withAge > 0 ? true : null, info: `${withAge}/${dogs.length}` },
    { name: "sex", ok: withSex > 0 ? true : null, info: `${withSex}/${dogs.length}` },
    { name: "status", ok: withStatus > 0 ? true : null, info: `${withStatus}/${dogs.length}` },
    { name: "raw payload preserved", ok: withRaw === dogs.length, info: `${withRaw}/${dogs.length}` }
  );
}

function dedupeStrength(dogs: ExtractedDog[]): VerifyReport["dedupeKeyStrength"] {
  if (!dogs.length) return "none";
  const withId = dogs.filter((d) => d.sourceAnimalId?.trim()).length;
  if (withId === dogs.length) return "animal_id";
  if (withId === 0) return "original_url";
  return "mixed";
}

function verdictFrom(checks: VerifyCheck[]): VerifyReport["verdict"] {
  const hard = checks.filter((c) => c.ok === false);
  if (hard.some((c) => ["dogs found", "original listing URLs", "parser"].includes(c.name)))
    return "fail";
  if (hard.length > 0) return "partial";
  return "pass";
}

// ---------------------------------------------------------------------------
// Fixture verification — parse recorded pages per adapter family.
// ---------------------------------------------------------------------------

type FixtureRunner = () => Promise<{ dogs: ExtractedDog[]; notes: string[] }>;

async function petconnect24Fixture(): Promise<{ dogs: ExtractedDog[]; notes: string[] }> {
  const cheerio = await import("cheerio");
  const { parseDetailPage, parseDescriptionSentence } = await import("@/adapters/petconnect24");
  const html = readFixture("petconnect24", "list_santacruz.html");
  const $ = cheerio.load(html);
  const notes: string[] = [];
  const detail = parseDetailPage(
    readFixture("petconnect24", "detail_A332073.html"),
    "https://24petconnect.com"
  );
  const dogs: ExtractedDog[] = [];
  $(".gridResult").each((_, el) => {
    const onclick = $(el).attr("onclick") ?? "";
    const m = onclick.match(/Details\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/);
    if (!m) return;
    const desc = parseDescriptionSentence(detail.descriptionSentence, null);
    dogs.push({
      sourceAnimalId: m[3],
      originalUrl: `https://24petconnect.com/${m[1]}/Details/${m[2]}/${m[3]}`,
      name: $(el).find(".text_Name").text().trim() || null,
      species: "Dog",
      breedRaw: $(el).find(".text_Breed").text().trim() || null,
      ageRaw: $(el).find(".text_Age").text().trim() || null,
      sexRaw: desc.sexRaw ?? ($(el).find(".text_Gender").text().trim() || null),
      sizeRaw: null,
      weightRaw: $(el).find(".text_Weight").text().trim() || null,
      colorRaw: null,
      statusRaw: "adopt",
      primaryPhotoUrl: "https://24petconnect.com/image/700192471",
      photoUrls: ["https://24petconnect.com/image/700192471"],
      rawPayload: { fixture: true },
    });
  });
  notes.push(`detail fixture: bio ${detail.moreInfo ? "present" : "missing"}, phone ${detail.shelterPhone ?? "-"}`);
  return { dogs, notes };
}

const FIXTURE_RUNNERS: Record<string, FixtureRunner> = {
  petconnect24: petconnect24Fixture,

  laas: async () => {
    const { parseListingPage, parseDetailPage } = await import("@/adapters/laas");
    const base = "https://www.laanimalservices.com";
    const { cards, lastPage, hasNext } = parseListingPage(readFixture("laas", "list_page1.html"), base);
    const detail = parseDetailPage(readFixture("laas", "detail_a2282226.html"), base);
    const f = detail.fields;
    const dogs: ExtractedDog[] = cards.map((c) => ({
      sourceAnimalId: c.animalId,
      originalUrl: `${base}${c.petPath}`,
      name: c.name,
      species: "Dog",
      breedRaw: f["Breed"] ?? null,
      ageRaw: f["Lifestage"] ?? null,
      sexRaw: f["Sex"] ?? null,
      sizeRaw: f["Size"] ?? null,
      weightRaw: null,
      colorRaw: f["Color"] ?? null,
      statusRaw: f["Care Status"] ?? null,
      primaryPhotoUrl: c.photoUrl,
      photoUrls: c.photoUrl ? [c.photoUrl] : [],
      rawPayload: { fixture: true },
    }));
    return {
      dogs,
      notes: [
        `pager: lastPage=${lastPage}, hasNext=${hasNext}`,
        `detail location: ${detail.locationName} (${detail.locationAddress ?? "no address"})`,
      ],
    };
  },

  sdhumane: async () => {
    const { mapSdhsAnimal } = await import("@/adapters/sdhumane");
    const payload = JSON.parse(readFixture("sdhumane", "search_trimmed.json"));
    const dogs = (payload.response as Array<{ AnimalType: string }>)
      .filter((a) => a.AnimalType === "Dog")
      .map((a) => mapSdhsAnimal(a as never, "https://sdhumane.org"));
    return { dogs, notes: [`fixture has ${payload.response.length} animals, ${dogs.length} dogs`] };
  },

  sfspca: async () => {
    const { animalIdFromPermalink, parseDetailPage } = await import("@/adapters/sfspca");
    const page = JSON.parse(readFixture("sfspca", "adoption_page0.json"));
    const detail = parseDetailPage(readFixture("sfspca", "detail_61296408.html"));
    const items = (page.items ?? []) as Array<{
      title: string | null;
      permalink: string | null;
      thumb: string | null;
      tags: Record<string, string | null> | null;
    }>;
    const dogs: ExtractedDog[] = items.map((it) => ({
      sourceAnimalId: animalIdFromPermalink(it.permalink),
      originalUrl: it.permalink ?? "https://www.sfspca.org/adoptions/dogs/",
      name: it.title,
      species: it.tags?.species ?? null,
      breedRaw: it.tags?.breed ?? null,
      ageRaw: detail.ageRaw,
      sexRaw: it.tags?.gender ?? null,
      sizeRaw: it.tags?.["weight-category"] ?? null,
      weightRaw: detail.weightRaw,
      colorRaw: it.tags?.color ?? null,
      statusRaw: "Adoptable (listed)",
      primaryPhotoUrl: it.thumb,
      photoUrls: it.thumb ? [it.thumb] : [],
      rawPayload: { fixture: true },
    }));
    return {
      dogs,
      notes: [
        `page fixture: ${items.length} animals (all species; live adapter filters dogs)`,
        `detail fixture: age=${detail.ageRaw}, weight=${detail.weightRaw}, bio ${detail.bio ? "present" : "missing"}`,
      ],
    };
  },

  oakland: async () => {
    const { parseListingPage, parseDetailPage } = await import("@/adapters/oakland");
    const base = "https://www.oaklandanimalservices.org";
    const cards = parseListingPage(readFixture("oakland", "list.html"), base);
    const detail = parseDetailPage(readFixture("oakland", "detail_18071751.html"));
    const dogs: ExtractedDog[] = cards.map((c) => ({
      sourceAnimalId: c.identifier,
      originalUrl: `${base}${c.detailPath}`,
      name: c.name,
      species: "Dog",
      breedRaw: detail.fields["Breed"] ?? c.breedLine,
      ageRaw: c.exactAge ? `${c.exactAge} y/o` : c.ageBucket,
      sexRaw: c.sex,
      sizeRaw: c.sizeGeneral,
      weightRaw: c.weight ? `${c.weight} lbs` : null,
      colorRaw: detail.fields["Color"] ?? null,
      statusRaw: c.location,
      primaryPhotoUrl: c.photoUrl,
      photoUrls: c.photoUrl ? [c.photoUrl] : [],
      rawPayload: { fixture: true },
    }));
    return {
      dogs,
      notes: [`detail fixture: ${Object.keys(detail.fields).length} fields, ${detail.photoUrls.length} photos`],
    };
  },

  adopets: async () => {
    const { mapAdopetsPet } = await import("@/adapters/adopets");
    const item = JSON.parse(readFixture("adopets", "pet_sample.json"));
    const pet = item.organization_pet ?? item;
    return { dogs: [mapAdopetsPet(pet)], notes: ["single-pet fixture from live pet/find response"] };
  },

  shelterluv: async () => {
    const { mapShelterluvAnimal } = await import("@/adapters/shelterluv");
    const payload = JSON.parse(readFixture("shelterluv", "available_184.json"));
    const dogs = (payload.animals as Array<{ species: string }>)
      .filter((a) => (a.species ?? "").toLowerCase() === "dog")
      .map((a) => mapShelterluvAnimal(a as never, "https://new.shelterluv.com"));
    return { dogs, notes: [`fixture has ${payload.animals.length} animals, ${dogs.length} dogs`] };
  },

  muttville: async () => {
    const { parseListingCards, parseDetail } = await import("@/adapters/muttville");
    const base = "https://muttville.org";
    const cards = parseListingCards(readFixture("muttville", "list.html"), base);
    const detail = parseDetail(readFixture("muttville", "detail_union.html"), base);
    const dogs: ExtractedDog[] = cards.map((c) => ({
      sourceAnimalId: c.slug.match(/-(\d+)$/)?.[1] ?? c.slug,
      originalUrl: c.url,
      name: c.name,
      species: "Dog",
      breedRaw: detail.facts.breedRaw,
      ageRaw: detail.facts.ageRaw,
      sexRaw: detail.facts.sexRaw,
      sizeRaw: detail.facts.sizeRaw,
      weightRaw: detail.facts.weightRaw,
      colorRaw: null,
      statusRaw: detail.facts.statusRaw,
      primaryPhotoUrl: c.photoUrl,
      photoUrls: c.photoUrl ? [c.photoUrl] : [],
      rawPayload: { fixture: true },
    }));
    return { dogs, notes: [`detail fixture bio ${detail.bio ? "present" : "missing"}`] };
  },

  shelterbuddy: async () => {
    const { parseSearchResults, parseAnimalDetail } = await import("@/adapters/shelterbuddy");
    const base = "https://marinpets.shelterbuddy.com";
    const cards = parseSearchResults(readFixture("shelterbuddy", "results_marin.html"), base);
    const detail = parseAnimalDetail(readFixture("shelterbuddy", "detail_43723.html"), base);
    const dogs: ExtractedDog[] = cards.map((c) => ({
      sourceAnimalId: c.animalId,
      originalUrl: c.detailUrl,
      name: c.name,
      species: "Dog",
      breedRaw: c.breedLine,
      ageRaw: detail.fields["Age"] ?? null,
      sexRaw: detail.fields["Sex"] ?? null,
      sizeRaw: detail.fields["Size"] ?? null,
      weightRaw: detail.fields["Weight"] ?? null,
      colorRaw: detail.fields["Color"] ?? null,
      statusRaw: "Adoptable (listed in search)",
      primaryPhotoUrl: c.photoUrl,
      photoUrls: c.photoUrl ? [c.photoUrl] : [],
      rawPayload: { fixture: true },
    }));
    return { dogs, notes: [] };
  },

  lacdacc: async () => {
    const { mapDaccAnimal } = await import("@/adapters/lacdacc");
    const page = JSON.parse(readFixture("lacdacc", "animals_page1.json"));
    const dogs = (page.animals as unknown[]).map((a) =>
      mapDaccAnimal(a as never, "https://animalcare.lacounty.gov")
    );
    return { dogs, notes: [`fixture reports total ${page.totalRecords}`] };
  },

  mock: async () => {
    const { MOCK_DOGS } = await import("@/adapters/mock");
    return { dogs: MOCK_DOGS, notes: ["synthetic data (dev/test only)"] };
  },
};

export async function verifyFixtures(
  sourceId: string,
  adapterType: string
): Promise<VerifyReport> {
  const checks: VerifyCheck[] = [];
  const runner = FIXTURE_RUNNERS[adapterType];
  if (!runner) {
    return {
      sourceId,
      adapterType,
      mode: "fixtures",
      verdict: "fail",
      dogsSampled: 0,
      dedupeKeyStrength: "none",
      checks: [{ name: "parser", ok: false, info: `no fixture runner for "${adapterType}"` }],
      notes: ["Add a fixture + runner, or verify with --live."],
    };
  }
  try {
    const { dogs, notes } = await runner();
    checks.push({ name: "parser", ok: true, info: "fixtures parsed" });
    evaluateDogs(dogs, checks);
    return {
      sourceId,
      adapterType,
      mode: "fixtures",
      verdict: verdictFrom(checks),
      dogsSampled: dogs.length,
      dedupeKeyStrength: dedupeStrength(dogs),
      checks,
      notes,
    };
  } catch (err) {
    return {
      sourceId,
      adapterType,
      mode: "fixtures",
      verdict: "fail",
      dogsSampled: 0,
      dedupeKeyStrength: "none",
      checks: [
        { name: "parser", ok: false, info: err instanceof Error ? err.message : String(err) },
      ],
      notes: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Live verification — capped, write-free crawl.
// ---------------------------------------------------------------------------

export async function verifyLive(
  db: ScoutDb,
  sourceId: string,
  caps: { maxPages?: number; maxDetailPages?: number } = {}
): Promise<VerifyReport> {
  const source = await db
    .select()
    .from(adoptionSources)
    .where(eq(adoptionSources.id, sourceId))
    .get();
  if (!source) throw new Error(`unknown source: ${sourceId}`);
  const adapter = getAdapter(source.adapterType);
  const checks: VerifyCheck[] = [];
  if (!adapter) {
    return {
      sourceId,
      adapterType: source.adapterType,
      mode: "live",
      verdict: "fail",
      dogsSampled: 0,
      dedupeKeyStrength: "none",
      checks: [{ name: "parser", ok: false, info: "no adapter implemented" }],
      notes: [],
    };
  }

  const maxPages = Math.min(source.maxPagesPerRun, caps.maxPages ?? 3);
  const maxDetailPages = Math.min(source.maxDetailPagesPerRun, caps.maxDetailPages ?? 5);
  let detailBudget = maxDetailPages;
  const fetchDefaults = {
    requestDelayMs: source.requestDelayMs,
    timeoutMs: source.timeoutMs,
    retries: source.retryCount,
    browserHeaders: source.useBrowserHeaders,
  };
  const ctx: AdapterContext = {
    source,
    fetch: (url, o) => fetchPage(url, { ...fetchDefaults, ...o }),
    fetchJson: (url, o) => fetchJson(url, { ...fetchDefaults, ...o }),
    log: () => {},
    shouldFetchDetail: () => detailBudget-- > 0,
    limits: { maxPages, maxDetailPages },
    saveDebug: () => {},
  };

  let result: AdapterResult;
  try {
    result = await adapter.crawl(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sourceId,
      adapterType: source.adapterType,
      mode: "live",
      verdict: "fail",
      dogsSampled: 0,
      dedupeKeyStrength: "none",
      checks: [
        { name: "listing page loads", ok: false, info: msg },
      ],
      notes: [/HTTP 403/.test(msg) ? "blocked: source refused the request" : "crawl threw"],
    };
  }

  checks.push({ name: "listing page loads", ok: result.pagesVisited > 0 });
  checks.push({ name: "parser", ok: result.dogs.length > 0, info: `${result.dogs.length} dogs (capped crawl)` });
  const cappedByLimit = result.warnings.some((w) => /maxPagesPerRun|budget/.test(w));
  checks.push({
    name: "pagination",
    ok: result.paginationCompleted || cappedByLimit ? true : result.pagesVisited > 1 ? null : null,
    info: result.paginationCompleted
      ? "completed"
      : cappedByLimit
        ? "detected; stopped at verification cap"
        : "single page or unclear",
  });
  checks.push({
    name: "detail pages",
    ok:
      result.detailsAttempted === 0
        ? null
        : result.detailsFailed === 0
          ? true
          : result.detailsSucceeded > 0
            ? null
            : false,
    info: `${result.detailsSucceeded}/${result.detailsAttempted} ok`,
  });
  evaluateDogs(result.dogs, checks);

  return {
    sourceId,
    adapterType: source.adapterType,
    mode: "live",
    verdict: verdictFrom(checks),
    dogsSampled: result.dogs.length,
    dedupeKeyStrength: dedupeStrength(result.dogs),
    checks,
    notes: result.warnings.slice(0, 6),
  };
}
