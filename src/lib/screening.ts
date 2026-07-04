import type { ParsedQuery } from "./aiSearch";

/**
 * Cute, specific screening lines for the matcher's loading state. EVERY line is
 * derived from something the query actually asked for — a visual trait, a
 * keyword, size/age/weight, breed, color, or location — paired with a real
 * candidate's name, so the loader reads as "evaluating this dog against YOUR
 * search," never a generic gag. Each criterion carries a few phrasings so a
 * long wait stays fresh without drifting off-topic.
 *
 * Pure + testable; imports only the ParsedQuery *type* (erased at build) so the
 * client can use it without pulling aiSearch.ts (which loads the Anthropic SDK).
 */

type Gen = (name: string) => string;

/** Placeholder names for the instant the loader needs to say SOMETHING but no
 *  real candidate names are known yet — reads as a real dog, never "this pup". */
export const FALLBACK_NAMES = [
  "Rocket", "Cody", "Bowser", "Biscuit", "Nala", "Duke", "Luna", "Buddy",
  "Daisy", "Max", "Bella", "Charlie", "Milo", "Rusty", "Peanut", "Ziggy",
] as const;

/** A fresh shuffle each call, so which fallback name leads (and their order)
 *  varies search to search instead of always starting "Rocket, Cody, …". */
function shuffledFallbackNames(): string[] {
  const a: string[] = [...FALLBACK_NAMES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function screeningLines(parsed: ParsedQuery, names: string[]): string[] {
  const pool = names.length ? names : shuffledFallbackNames();

  // Each active criterion contributes a small bank of on-topic phrasings.
  const gens: Gen[][] = [];

  for (const t of parsed.visualTraits) {
    const s = t.toLowerCase();
    if (/ear/.test(s)) gens.push([(n) => `Analyzing ${n}'s ear floppiness`, (n) => `Measuring ${n}'s ear-to-head ratio`]);
    else if (/eye/.test(s)) gens.push([(n) => `Gazing into ${n}'s eyes`, (n) => `Admiring ${n}'s soulful eyes`]);
    else if (/leg|tripod|three/.test(s)) gens.push([(n) => `Counting ${n}'s legs`, (n) => `Checking ${n}'s stride`]);
    else if (/long.?hair|long.?coat|shag|feather|\blong\b/.test(s))
      gens.push([(n) => `Measuring ${n}'s hair length`, (n) => `Combing out ${n}'s long coat`]);
    else if (/fluff|floof/.test(s)) gens.push([(n) => `Testing ${n}'s floof factor`, (n) => `Fluffing up ${n}`]);
    else if (/scruff|wiry/.test(s)) gens.push([(n) => `Ruffling ${n}'s scruff`, (n) => `Admiring ${n}'s scruffy coat`]);
    else if (/curl|curly|poodle|wavy/.test(s)) gens.push([(n) => `Springing ${n}'s curls`, (n) => `Checking ${n}'s curl bounce`]);
    else if (/smooth|short.?hair|short.?coat|sleek/.test(s))
      gens.push([(n) => `Smoothing ${n}'s sleek coat`, (n) => `Petting ${n}'s short coat`]);
    else if (/coat|fur|hair/.test(s))
      gens.push([(n) => `Running fingers through ${n}'s coat`, (n) => `Admiring ${n}'s ${t}`]);
    else if (/spot|patch|brindle|merle|mark|color/.test(s)) gens.push([(n) => `Inspecting ${n}'s markings`, (n) => `Counting ${n}'s spots`]);
    else if (/senior|gray|grey|old|beard|muzzle/.test(s)) gens.push([(n) => `Counting ${n}'s gray hairs`, (n) => `Booping ${n}'s greying snoot`]);
    else gens.push([(n) => `Checking ${n} for ${t}`, (n) => `Looking for ${t} on ${n}`]);
  }

  for (const k of parsed.keywords) {
    const s = k.toLowerCase();
    if (/cat|felin/.test(s)) gens.push([(n) => `Testing ${n}'s temperament with felines`, (n) => `Introducing ${n} to an imaginary cat`]);
    else if (/kid|child|toddler|baby|famil/.test(s)) gens.push([(n) => `Seeing how ${n} does with kids`, (n) => `Picturing ${n} at a birthday party`]);
    else if (/\bdog|other pet|pack/.test(s)) gens.push([(n) => `Introducing ${n} to other dogs`, (n) => `Gauging ${n}'s dog-park manners`]);
    else if (/apartment|small space|condo|studio/.test(s)) gens.push([(n) => `Picturing ${n} in a cozy apartment`, (n) => `Fitting ${n} into a studio`]);
    else if (/yard|garden|fence/.test(s)) gens.push([(n) => `Imagining ${n} patrolling the yard`]);
    else if (/belly|tummy|\brub|tickle/.test(s)) gens.push([(n) => `Rubbing ${n}'s belly`, (n) => `Testing ${n}'s belly-rub tolerance`]);
    else if (/love|affection|sweet|snuggl|velcro|clingy/.test(s)) gens.push([(n) => `Measuring ${n}'s affection levels`, (n) => `Counting ${n}'s cuddles per minute`]);
    // calm/low-energy BEFORE active — so "low energy" doesn't match "energetic"
    else if (/cuddl|lap|calm|mellow|couch|chill|quiet|gentle|relax|low.?energy|lazy|laid.?back|snuggl|nap/.test(s))
      gens.push([(n) => `Gauging ${n}'s cuddle potential`, (n) => `Warming up a lap for ${n}`]);
    else if (/hik|trail|active|adventur|energetic|high.?energy|sporty|\brun|fetch|play/.test(s))
      gens.push([(n) => `Taking ${n} on an imaginary hike`, (n) => `Clocking ${n}'s zoomies`]);
    else if (/hypoallergen|shed|allerg/.test(s)) gens.push([(n) => `Checking ${n}'s coat for shedding`, (n) => `Testing ${n} for the sneeze factor`]);
    else if (/house|potty|train|leash|manner/.test(s)) gens.push([(n) => `Reviewing ${n}'s house manners`, (n) => `Checking ${n}'s leash skills`]);
    else gens.push([(n) => `Reading ${n}'s bio for “${k}”`, (n) => `Matching ${n} to “${k}”`]);
  }

  if (parsed.maxWeightLbs != null || parsed.minWeightLbs != null)
    gens.push([(n) => `Weighing ${n} on the scale`, (n) => `Checking ${n} fits the weight range`]);
  if (parsed.sizes.length) gens.push([(n) => `Sizing up ${n}`, (n) => `Measuring ${n} paw to shoulder`]);
  for (const a of parsed.ageBuckets) {
    if (a === "senior") gens.push([(n) => `Counting ${n}'s gray hairs`, (n) => `Confirming ${n}'s golden years`]);
    else if (a === "puppy") gens.push([(n) => `Confirming ${n}'s puppy energy`, (n) => `Checking ${n} still has puppy breath`]);
    else gens.push([(n) => `Checking ${n}'s age`, (n) => `Confirming ${n} is ${a}`]);
  }
  if (parsed.minDaysInShelter != null)
    gens.push([(n) => `Counting how long ${n} has waited`, (n) => `Noting ${n}'s time in the kennel`]);
  for (const c of parsed.colors) gens.push([(n) => `Matching ${n}'s ${c} coat`, (n) => `Confirming ${n} is ${c}`]);
  for (const b of parsed.breedIncludes) gens.push([(n) => `Confirming ${n} is a ${b}`, (n) => `Studying ${n}'s ${b} traits`]);
  if (parsed.nearPlace) gens.push([(n) => `Mapping the drive to ${n}`, (n) => `Measuring the miles to ${n}`]);

  // Bare query (no criteria) — still relevant to the dog, never a random gag.
  if (!gens.length)
    gens.push([(n) => `Getting to know ${n}`, (n) => `Reading ${n}'s story`, (n) => `Saying hi to ${n}`, (n) => `Meeting ${n}`]);

  return buildLines(gens, pool);
}

/** Round-robin the criteria banks into interleaved lines — each criterion
 * rotates through its own phrasings, cycling names — plentiful AND on-topic. */
function buildLines(gens: Gen[][], pool: string[]): string[] {
  let ni = 0;
  const who = () => pool[ni++ % pool.length];
  const varIdx = gens.map(() => 0);
  const out: string[] = [];
  for (let g = 0, guard = 0; out.length < 12 && guard < 240; g++, guard++) {
    const gi = g % gens.length;
    const bank = gens[gi];
    out.push(bank[varIdx[gi]++ % bank.length](who()));
  }
  return out;
}

/**
 * Loading lines built straight from the RAW query text — used the instant a
 * search starts, before the structured parse returns, so the status never gets
 * stuck repeating "Scouting…". It scans the query for the same vocabulary the
 * parser looks for and makes plausible, on-topic phrases (names default to a
 * rotating cast of placeholder dog names); once the real parse lands,
 * screeningLines() takes over.
 */
export function screeningLinesForText(query: string, names: string[]): string[] {
  const s = ` ${query.toLowerCase()} `;
  const pool = names.length ? names : shuffledFallbackNames();
  const gens: Gen[][] = [];
  const has = (re: RegExp) => re.test(s);

  if (has(/poodle|doodle/)) gens.push([(n) => `Checking ${n}'s poodle traits`, (n) => `Confirming ${n} is a poodle mix`]);
  else {
    const b = s.match(/\b(terrier|chihuahua|labrador|\blab\b|retriever|shepherd|husky|pit ?bull|bulldog|dachshund|beagle|boxer|corgi|shih ?tzu|pug|collie|hound|spaniel|mastiff|pomeranian)\b/);
    if (b) gens.push([(n) => `Confirming ${n} is a ${b[1].trim()}`, (n) => `Studying ${n}'s ${b[1].trim()} side`]);
  }
  if (has(/long.?hair|long.?coat|shag/)) gens.push([(n) => `Measuring ${n}'s hair length`, (n) => `Combing out ${n}'s long coat`]);
  else if (has(/fluff|floof/)) gens.push([(n) => `Testing ${n}'s floof factor`, (n) => `Fluffing up ${n}`]);
  else if (has(/scruff|wiry/)) gens.push([(n) => `Ruffling ${n}'s scruff`, (n) => `Admiring ${n}'s scruffy coat`]);
  else if (has(/curl|curly|wavy/)) gens.push([(n) => `Springing ${n}'s curls`, (n) => `Checking ${n}'s curl bounce`]);
  else if (has(/coat|fur|\bhair/)) gens.push([(n) => `Running fingers through ${n}'s coat`, (n) => `Admiring ${n}'s coat`]);
  if (has(/hypoallergen|allerg|shed/)) gens.push([(n) => `Checking ${n} for the sneeze factor`, (n) => `Inspecting ${n}'s coat for shedding`]);
  if (has(/belly|tummy|\brub|tickle/)) gens.push([(n) => `Rubbing ${n}'s belly`, (n) => `Testing ${n}'s belly-rub tolerance`]);
  if (has(/cuddl|lap|snuggl|couch|calm|mellow|chill|quiet|gentle|low.?energy|lazy|laid.?back/))
    gens.push([(n) => `Gauging ${n}'s cuddle potential`, (n) => `Warming up a lap for ${n}`]);
  if (has(/hik|trail|active|adventur|energetic|sporty|\brun|fetch|\bplay/))
    gens.push([(n) => `Taking ${n} on an imaginary hike`, (n) => `Clocking ${n}'s zoomies`]);
  if (has(/cat|felin/)) gens.push([(n) => `Testing ${n}'s temperament with felines`, (n) => `Introducing ${n} to an imaginary cat`]);
  if (has(/kid|child|toddler|famil/)) gens.push([(n) => `Seeing how ${n} does with kids`, (n) => `Picturing ${n} at a birthday party`]);
  if (has(/other dog|with dog|dog.?park|\bpack\b/)) gens.push([(n) => `Introducing ${n} to other dogs`, (n) => `Gauging ${n}'s dog-park manners`]);
  if (has(/apartment|condo|studio|small space/)) gens.push([(n) => `Picturing ${n} in a cozy apartment`, (n) => `Fitting ${n} into a studio`]);
  if (has(/house|potty|leash|train|manner/)) gens.push([(n) => `Reviewing ${n}'s house manners`, (n) => `Checking ${n}'s leash skills`]);
  if (has(/\d\s*(lb|pound|kg)|under|over|\bsmall|tiny|large|\bbig|medium|huge|giant/))
    gens.push([(n) => `Weighing ${n} on the scale`, (n) => `Sizing up ${n}`]);
  if (has(/senior|\bold|gray|grey|elder/)) gens.push([(n) => `Counting ${n}'s gray hairs`, (n) => `Confirming ${n}'s golden years`]);
  if (has(/pupp/)) gens.push([(n) => `Confirming ${n}'s puppy energy`, (n) => `Checking ${n} still has puppy breath`]);
  if (has(/near |oakland|san |los angeles|\bla\b|sacramento|diego|francisco|bay area|valley/))
    gens.push([(n) => `Mapping the drive to ${n}`, (n) => `Measuring the miles to ${n}`]);

  if (!gens.length) gens.push([(n) => `Reading ${n}'s story`, (n) => `Getting to know ${n}`, (n) => `Sizing up ${n}`, (n) => `Meeting ${n}`]);
  return buildLines(gens, pool);
}
