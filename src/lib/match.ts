import { haversineMiles } from "./geo";
import { ageBucketFromMonths } from "./normalize";
import type { AgeBucket, SizeNormalized, StatusNormalized } from "./types";

/**
 * Deterministic saved-search matching. Phase one is intentionally simple:
 * boolean criteria with human-readable reasons, no scoring, no AI.
 * A future Claude enrichment layer can consume the same MatchInput and add
 * fuzzy/temperament matching on top — this is the extension point.
 */

export interface SearchCriteria {
  /** Match if ANY of these tokens appears in the breed text. */
  breedIncludes?: string[];
  /** Reject if ANY of these tokens appears in the breed text. */
  breedExcludes?: string[];
  ageMonthsMin?: number;
  ageMonthsMax?: number;
  ageBuckets?: AgeBucket[];
  excludePuppies?: boolean;
  sizes?: SizeNormalized[];
  weightLbsMin?: number;
  weightLbsMax?: number;
  /** Match if ANY of these colors appears in colorsNormalized. */
  colors?: string[];
  statuses?: StatusNormalized[];
  center?: { latitude: number; longitude: number };
  maxDistanceMiles?: number;
  sexes?: Array<"male" | "female">;
  /** Length-of-stay bounds in days (e.g. "in the shelter more than 2 months" → min 60). */
  daysInShelterMin?: number;
  daysInShelterMax?: number;
}

export interface MatchInput {
  breedNormalized: string | null;
  breedRaw: string | null;
  ageMonthsEstimate: number | null;
  ageRaw: string | null;
  sizeNormalized: SizeNormalized | null;
  weightLbsEstimate: number | null;
  colorsNormalized: string[] | null;
  statusNormalized: StatusNormalized;
  sex: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Days since intake, when the source exposes an intake date. Optional so
   * older call sites (saved searches) keep working without it. */
  daysInShelter?: number | null;
}

export interface MatchResult {
  matched: boolean;
  /** Criteria that passed, human-readable ("breed matches 'dachshund'"). */
  reasons: string[];
  /** Criteria that failed. */
  failures: string[];
  /** Criteria that could not be evaluated because the listing lacks data. */
  unknowns: string[];
}

export function matchListing(dog: MatchInput, c: SearchCriteria): MatchResult {
  const reasons: string[] = [];
  const failures: string[] = [];
  const unknowns: string[] = [];

  const breedText = [dog.breedNormalized, dog.breedRaw]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (c.breedIncludes?.length) {
    const hit = c.breedIncludes.find((b) => breedText.includes(b.toLowerCase()));
    if (!breedText) unknowns.push("breed unknown");
    else if (hit) reasons.push(`breed matches "${hit}"`);
    else failures.push(`breed does not match any of: ${c.breedIncludes.join(", ")}`);
  }

  if (c.breedExcludes?.length && breedText) {
    const hit = c.breedExcludes.find((b) => breedText.includes(b.toLowerCase()));
    if (hit) failures.push(`breed excluded by "${hit}"`);
  }

  const bucket = ageBucketFromMonths(dog.ageMonthsEstimate);
  if (c.excludePuppies) {
    if (bucket === "puppy" || /\bpupp/i.test(dog.ageRaw ?? "")) {
      failures.push("puppies excluded");
    } else if (dog.ageMonthsEstimate == null && !dog.ageRaw) {
      unknowns.push("age unknown (cannot confirm not a puppy)");
    } else {
      reasons.push("not a puppy");
    }
  }
  if (c.ageMonthsMin != null || c.ageMonthsMax != null) {
    if (dog.ageMonthsEstimate == null) {
      unknowns.push("age unknown");
    } else if (
      (c.ageMonthsMin == null || dog.ageMonthsEstimate >= c.ageMonthsMin) &&
      (c.ageMonthsMax == null || dog.ageMonthsEstimate <= c.ageMonthsMax)
    ) {
      reasons.push(`age ${dog.ageMonthsEstimate}mo in range`);
    } else {
      failures.push(`age ${dog.ageMonthsEstimate}mo outside range`);
    }
  }
  if (c.ageBuckets?.length) {
    if (!bucket) unknowns.push("age bucket unknown");
    else if (c.ageBuckets.includes(bucket)) reasons.push(`age bucket "${bucket}"`);
    else failures.push(`age bucket "${bucket}" not in ${c.ageBuckets.join("/")}`);
  }

  if (c.sizes?.length) {
    if (!dog.sizeNormalized) unknowns.push("size unknown");
    else if (c.sizes.includes(dog.sizeNormalized)) reasons.push(`size "${dog.sizeNormalized}"`);
    else failures.push(`size "${dog.sizeNormalized}" not in ${c.sizes.join("/")}`);
  }
  if (c.weightLbsMin != null || c.weightLbsMax != null) {
    if (dog.weightLbsEstimate == null) unknowns.push("weight unknown");
    else if (
      (c.weightLbsMin == null || dog.weightLbsEstimate >= c.weightLbsMin) &&
      (c.weightLbsMax == null || dog.weightLbsEstimate <= c.weightLbsMax)
    )
      reasons.push(`weight ${dog.weightLbsEstimate}lbs in range`);
    else failures.push(`weight ${dog.weightLbsEstimate}lbs outside range`);
  }

  if (c.colors?.length) {
    const dogColors = (dog.colorsNormalized ?? []).map((x) => x.toLowerCase());
    if (!dogColors.length) unknowns.push("color unknown");
    else {
      const hit = c.colors.find((col) => dogColors.includes(col.toLowerCase()));
      if (hit) reasons.push(`color "${hit}"`);
      else failures.push(`colors [${dogColors.join(", ")}] don't include ${c.colors.join("/")}`);
    }
  }

  if (c.statuses?.length) {
    if (c.statuses.includes(dog.statusNormalized))
      reasons.push(`status "${dog.statusNormalized}"`);
    else failures.push(`status "${dog.statusNormalized}" not in ${c.statuses.join("/")}`);
  }

  if (c.sexes?.length) {
    if (dog.sex !== "male" && dog.sex !== "female") unknowns.push("sex unknown");
    else if (c.sexes.includes(dog.sex)) reasons.push(`sex "${dog.sex}"`);
    else failures.push(`sex "${dog.sex}" not in ${c.sexes.join("/")}`);
  }

  if (c.daysInShelterMin != null || c.daysInShelterMax != null) {
    const days = dog.daysInShelter ?? null;
    if (days == null) {
      unknowns.push("length of stay unknown (no intake date)");
    } else if (
      (c.daysInShelterMin == null || days >= c.daysInShelterMin) &&
      (c.daysInShelterMax == null || days <= c.daysInShelterMax)
    ) {
      reasons.push(`${days} days in shelter`);
    } else {
      failures.push(`${days} days in shelter outside range`);
    }
  }

  if (c.center && c.maxDistanceMiles != null) {
    if (dog.latitude == null || dog.longitude == null) {
      unknowns.push("location unknown");
    } else {
      const miles = haversineMiles(
        c.center.latitude,
        c.center.longitude,
        dog.latitude,
        dog.longitude
      );
      if (miles <= c.maxDistanceMiles)
        reasons.push(`${Math.round(miles)} mi away (≤ ${c.maxDistanceMiles})`);
      else failures.push(`${Math.round(miles)} mi away (> ${c.maxDistanceMiles})`);
    }
  }

  // Unknowns don't fail a match — they're surfaced so a human (or later, Claude)
  // can decide. Only explicit failures reject.
  return { matched: failures.length === 0, reasons, failures, unknowns };
}
