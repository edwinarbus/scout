import type {
  AgeBucket,
  Sex,
  SizeNormalized,
  StatusNormalized,
  TriState,
} from "./types";

/**
 * Normalizers turn messy shelter text into comparable values.
 * Rules:
 *  - Raw values are always preserved by the caller; these functions only add
 *    a normalized interpretation alongside them.
 *  - When a value is ambiguous, return null/unknown. Never guess.
 */

const clean = (s: string | null | undefined): string | null => {
  if (s == null) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length ? t : null;
};

export function normalizeName(raw: string | null | undefined): string | null {
  let s = clean(raw);
  if (!s) return null;
  // Shelters often decorate names: "*BUDDY", "PATTIE GONIA* (A332073)"
  s = s.replace(/\(([A-Za-z]?\d{4,})\)\s*$/, "").trim(); // trailing "(A332073)"
  s = s.replace(/^\*+|\*+$/g, "").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Title-case ALL-CAPS shelter names; leave mixed case alone.
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s
      .toLowerCase()
      .replace(/(^|[\s\-'/])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  }
  return s;
}

/** Names that are really placeholders/ids — never merged across sources. */
export function isPlaceholderName(name: string | null): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length < 2) return true;
  if (/^[a-z]?\d{4,}$/i.test(n)) return true; // "A5786773", "230026"
  return [
    "unknown",
    "no name",
    "noname",
    "unnamed",
    "puppy",
    "pup",
    "dog",
    "stray",
    "n/a",
    "pending",
  ].includes(n);
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

export interface AgeEstimate {
  months: number | null;
  bucket: AgeBucket | null;
}

export function ageBucketFromMonths(months: number | null): AgeBucket | null {
  if (months == null) return null;
  if (months < 12) return "puppy";
  if (months < 36) return "young";
  if (months < 96) return "adult";
  return "senior";
}

/**
 * Parse free-text age like "2 years 3 months", "13 weeks old",
 * "1Yrs 2Mths 1Wks (approx)", "Est. age: 14 yrs", "8 mo", "Senior".
 * `referenceDate` is used for DOB-style input and injected in tests.
 */
export function parseAgeToMonths(
  raw: string | null | undefined,
  referenceDate: Date = new Date()
): AgeEstimate {
  const s = clean(raw)?.toLowerCase() ?? null;
  if (!s) return { months: null, bucket: null };

  // Explicit DOB, e.g. "dob 05/01/2023" or "born 2023-05-01"
  const dob = s.match(/(?:dob|born|date of birth)[:\s]*([0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4})/);
  if (dob) {
    const d = parseLooseDate(dob[1]);
    if (d) {
      const months = monthsBetween(d, referenceDate);
      return { months, bucket: ageBucketFromMonths(months) };
    }
  }

  // If the source labels the lifestage in words, that label wins for the
  // bucket even when numbers are also present ("Senior Dog: 7+ yrs.").
  const wordBucket: AgeBucket | null = /\bpupp(y|ies)\b/.test(s)
    ? "puppy"
    : /\bsenior\b/.test(s)
      ? "senior"
      : /\byoung\b/.test(s)
        ? "young"
        : /\badult\b/.test(s)
          ? "adult"
          : null;

  // Range lifestages ("1-3 yrs", "3-7 years") → midpoint.
  const range = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/);
  if (range) {
    const mid = Math.round(((parseFloat(range[1]) + parseFloat(range[2])) / 2) * 12);
    return { months: mid, bucket: wordBucket ?? ageBucketFromMonths(mid) };
  }
  // "Under 1 yr" → bucket only, no fabricated month estimate.
  const under = s.match(/under\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)\b/);
  if (under) {
    return {
      months: null,
      bucket: wordBucket ?? (parseFloat(under[1]) <= 1 ? "puppy" : null),
    };
  }
  // "7+ yrs" → treat the floor as the estimate.
  const plus = s.match(/(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)\b/);
  if (plus) {
    const m = Math.round(parseFloat(plus[1]) * 12);
    return { months: m, bucket: wordBucket ?? ageBucketFromMonths(m) };
  }

  let months = 0;
  let matched = false;
  const yr = s.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)\b/);
  if (yr) {
    months += Math.round(parseFloat(yr[1]) * 12);
    matched = true;
  }
  const mo = s.match(/(\d+(?:\.\d+)?)\s*(?:months?|mths?|mos?|m)\b/);
  if (mo) {
    months += Math.round(parseFloat(mo[1]));
    matched = true;
  }
  const wk = s.match(/(\d+(?:\.\d+)?)\s*(?:weeks?|wks?|w)\b/);
  if (wk) {
    months += Math.round((parseFloat(wk[1]) * 7) / 30.44);
    matched = true;
  }
  const dy = s.match(/(\d+(?:\.\d+)?)\s*(?:days?)\b/);
  if (dy) {
    months += Math.round(parseFloat(dy[1]) / 30.44);
    matched = true;
  }
  if (matched) {
    // "0 months" for a listed dog is a data artifact, not a newborn.
    if (months <= 0) return { months: null, bucket: wordBucket };
    return { months, bucket: wordBucket ?? ageBucketFromMonths(months) };
  }

  // Bare number = assume years if small ("3"), ambiguous otherwise.
  const bare = s.match(/^(\d{1,2})$/);
  if (bare) {
    const m = parseInt(bare[1], 10) * 12;
    return { months: m, bucket: ageBucketFromMonths(m) };
  }

  // Word bucket only — no month estimate.
  return { months: null, bucket: wordBucket };
}

function monthsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.round(ms / (30.44 * 24 * 3600 * 1000)));
}

/** Parse "6/27/2026", "2026-06-27", "Jun 27, 2026" into ISO yyyy-mm-dd. */
export function parseLooseDate(raw: string | null | undefined): Date | null {
  const s = clean(raw);
  if (!s) return null;
  // yyyy-mm-dd
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return dateOrNull(+m[1], +m[2], +m[3]);
  // mm/dd/yyyy (US shelters)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return dateOrNull(+m[3], +m[1], +m[2]);
  // "Jun 27, 2026"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return dateOrNull(+m[3], month + 1, +m[2]);
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dateOrNull(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

export function toIsoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Sex
// ---------------------------------------------------------------------------

export interface SexResult {
  sex: Sex;
  /** true if the sex string itself implies altered (e.g. "Neutered Male"). */
  spayedNeutered: TriState;
}

export function normalizeSex(raw: string | null | undefined): SexResult {
  const s = clean(raw)?.toLowerCase() ?? "";
  const altered = /(spayed|neutered|altered|desexed|fixed)/.test(s)
    ? true
    : /\bintact\b|unaltered/.test(s)
      ? false
      : null;
  if (/\b(female|f)\b/.test(s) || s.startsWith("f")) {
    if (/female|^f\b|^f$|spayed/.test(s)) return { sex: "female", spayedNeutered: altered };
  }
  if (/female/.test(s)) return { sex: "female", spayedNeutered: altered };
  if (/\bmale\b|^m$|^m\b/.test(s)) return { sex: "male", spayedNeutered: altered };
  return { sex: "unknown", spayedNeutered: altered };
}

// ---------------------------------------------------------------------------
// Weight & size
// ---------------------------------------------------------------------------

export function parseWeightLbs(raw: string | null | undefined): number | null {
  const s = clean(raw)?.toLowerCase() ?? null;
  if (!s) return null;
  const kg = s.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilos?|kilograms?)\b/);
  if (kg) return round1(parseFloat(kg[1]) * 2.20462);
  const lb = s.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?|#)\b/);
  if (lb) return round1(parseFloat(lb[1]));
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return round1(parseFloat(bare[1])); // assume lbs (US shelters)
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function normalizeSize(
  sizeRaw: string | null | undefined,
  weightLbs: number | null = null
): SizeNormalized | null {
  const s = clean(sizeRaw)?.toLowerCase() ?? "";
  if (s) {
    if (/x[-\s]?large|extra[-\s]?large|\bxl\b|giant/.test(s)) return "xlarge";
    if (/\blarge\b|\blg\b|\bl\b/.test(s)) return "large";
    if (/\bmed(ium)?\b|\bm\b/.test(s)) return "medium";
    if (/\bsmall\b|\bsm\b|\bs\b|\btoy\b|\bmini\b/.test(s)) return "small";
    // 24petconnect/DACC use "PUPPY" as a size class — not a physical size; fall through to weight.
  }
  if (weightLbs != null) {
    if (weightLbs < 26) return "small";
    if (weightLbs <= 60) return "medium";
    if (weightLbs <= 99) return "large";
    return "xlarge";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Breed
// ---------------------------------------------------------------------------

/** Common shelter abbreviations → canonical breed words. Deliberately small. */
const BREED_ALIASES: Record<string, string> = {
  "germ shepherd": "german shepherd",
  "german shepherd dog": "german shepherd",
  gsd: "german shepherd",
  "belg malinois": "belgian malinois",
  "pit bull terrier": "pit bull",
  "pit bull ter": "pit bull",
  "am pit bull ter": "pit bull",
  "american pit bull terrier": "pit bull",
  "staffordshire bull terrier": "staffordshire terrier",
  "am staff": "staffordshire terrier",
  "amer staff": "staffordshire terrier",
  "chihuahua sh": "chihuahua",
  "chihuahua lh": "chihuahua",
  "chihuahua smooth coat": "chihuahua",
  "chihuahua long coat": "chihuahua",
  "dachshund smooth": "dachshund",
  "doxie": "dachshund",
  "lab retriever": "labrador retriever",
  labrador: "labrador retriever",
  "labrador retr": "labrador retriever",
  "golden retr": "golden retriever",
  "aust shepherd": "australian shepherd",
  "aust cattle dog": "australian cattle dog",
  "queensland heeler": "australian cattle dog",
  heeler: "australian cattle dog",
  "jack russ terrier": "jack russell terrier",
  "yorkshire terr": "yorkshire terrier",
  yorkie: "yorkshire terrier",
  "poodle min": "miniature poodle",
  "poodle toy": "toy poodle",
  "poodle stnd": "standard poodle",
  "alask husky": "husky",
  "siberian husky": "husky",
  "catahoula leopard dog": "catahoula",
  "cane corso mastiff": "cane corso",
  "st bernard": "saint bernard",
};

export interface BreedResult {
  /** Human-readable normalized breed string, e.g. "labrador retriever / belgian malinois mix". */
  normalized: string | null;
  /** Lowercased breed tokens for matching, e.g. ["labrador retriever", "belgian malinois"]. */
  tokens: string[];
  isMix: boolean;
}

export function normalizeBreed(raw: string | null | undefined): BreedResult {
  const s = clean(raw)?.toLowerCase() ?? null;
  if (!s || s === "unknown" || s === "mixed" || s === "mixed breed" || s === "mix") {
    return { normalized: s ? "mixed breed" : null, tokens: s ? ["mixed breed"] : [], isMix: !!s };
  }
  let isMix = /\bmix(ed)?\b|\bcross\b|\bx\b/.test(s);
  const parts = s
    .replace(/\bmix(ed)?( breed)?\b/g, "")
    .replace(/\bcross\b/g, "/")
    .replace(/\s+and\s+/g, "/")
    .replace(/\s*&\s*/g, "/")
    .split(/[/,]/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const tokens: string[] = [];
  for (let p of parts) {
    p = BREED_ALIASES[p] ?? p;
    if (p && !tokens.includes(p)) tokens.push(p);
  }
  if (tokens.length > 1) isMix = true;
  if (!tokens.length) return { normalized: null, tokens: [], isMix };
  return {
    normalized: tokens.join(" / ") + (isMix && tokens.length === 1 ? " mix" : ""),
    tokens,
    isMix,
  };
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

const COLOR_ALIASES: Record<string, string> = {
  blk: "black",
  bk: "black",
  wht: "white",
  wh: "white",
  brn: "brown",
  br: "brown",
  choc: "chocolate",
  gray: "gray",
  grey: "gray",
  gr: "gray",
  slvr: "silver",
  yel: "yellow",
  gold: "golden",
  bld: "blonde",
  rd: "red",
  org: "orange",
  crm: "cream",
  buff: "buff",
  tan: "tan",
  fawn: "fawn",
  apricot: "apricot",
  brindle: "brindle",
  brdl: "brindle",
  merle: "merle",
  "blue merle": "blue merle",
  "red merle": "red merle",
  tricolor: "tricolor",
  "tri color": "tricolor",
  tri: "tricolor",
  sable: "sable",
  blue: "blue",
  liver: "liver",
  seal: "seal",
};

export function normalizeColors(raw: string | null | undefined): string[] {
  const s = clean(raw)?.toLowerCase();
  if (!s) return [];
  const parts = s
    .replace(/\s+and\s+/g, "/")
    .replace(/\s*&\s*/g, "/")
    .replace(/\s*-\s*/g, "/")
    .split(/[/,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const c = COLOR_ALIASES[p] ?? p;
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Map raw shelter status text to a coarse normalized status.
 * Raw text is always preserved by the caller; unknown inputs → "unknown".
 */
export function normalizeStatus(raw: string | null | undefined): StatusNormalized {
  const s = clean(raw)?.toLowerCase() ?? null;
  if (!s) return "unknown";
  if (/rescue\s*only|rescue-only/.test(s)) return "rescue_only";
  if (/stray\s*(wait|hold)/.test(s)) return "stray_hold";
  if (/medical|med\s*hold|vet\s*hold/.test(s)) return "medical_hold";
  if (/adopt(ed|ion complete)/.test(s) && !/pend/.test(s)) return "adopted";
  if (/pend/.test(s)) return "pending"; // "ADOPTION PENDING", "AV PEND SN", "Pending"
  if (/\bhold\b|^id hold|other hold|behavior hold|evidence/.test(s)) return "hold";
  if (/foster/.test(s)) return "foster";
  if (/not\s*(currently\s*)?available|unavailable|no longer/.test(s)) return "not_available";
  // LAAS care status: a dog on the adoptable list whose care status is
  // "In Shelter" is available; "In Foster" maps to foster above.
  if (/^in shelter$/.test(s)) return "available";
  if (/rtgh|ready to go home|available|adoptable|^adopt$|^av\b|^avail/.test(s)) return "available";
  if (/stray wait/.test(s)) return "stray_hold";
  return "unknown";
}

/** Statuses that mean "you could plausibly adopt this dog right now-ish". */
export function isAdoptableStatus(status: StatusNormalized): boolean {
  return status === "available" || status === "foster" || status === "unknown";
}

// ---------------------------------------------------------------------------
// Misc text helpers used by adapters
// ---------------------------------------------------------------------------

export function parseYesNo(raw: string | null | undefined): TriState {
  const s = clean(raw)?.toLowerCase() ?? null;
  if (!s) return null;
  if (/^(y|yes|true|ok|good)/.test(s)) return true;
  if (/^(n|no|false|not)/.test(s)) return false;
  return null;
}

export { clean as cleanText };
