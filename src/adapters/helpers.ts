/** Small shared helpers for HTML adapters. */

export function absUrl(base: string, href: string | undefined | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Collapse whitespace and trim; empty → null. */
export function squish(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

/** Convert <br> to newlines then strip tags — for bio-style HTML fragments. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#822[01];/g, '"')
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length ? text : null;
}

/**
 * A prose bio can carry a literal newline character ALONGSIDE a `<br>` tag
 * for the same line wrap — an authoring artifact from whoever wrote it
 * hard-wrapping a long line in their editor, not an intended break (seen in
 * ShelterLuv's `kennel_description`). A browser rendering that markup
 * collapses the raw newline away as insignificant whitespace and shows only
 * the ONE break the `<br>` draws; naively converting both signals to `\n`
 * doubles it into a blank PARAGRAPH gap landing mid-sentence. Even a single
 * resulting `\n` still hard-wraps at that exact character offset regardless
 * of the reader's actual line width, so — unlike a genuine `<br><br>`
 * (clearly an intentional break, kept as a real paragraph gap) — any
 * ISOLATED `<br>` is treated as the wrap artifact it almost certainly is and
 * reflows as plain text instead. Call this on prose bios specifically
 * (rather than changing the shared htmlToText, which structured-field
 * adapters rely on to use single `<br>` as a real line delimiter). */
export function htmlToProseText(html: string | null | undefined): string | null {
  if (!html) return null;
  const PARA = " PARA "; // placeholder that can't collide with real text
  const normalized = html
    .replace(/\s+/g, " ")
    .replace(/(?:<br\s*\/?>\s*){2,}/gi, PARA)
    .replace(/<br\s*\/?>/gi, " ")
    .split(PARA)
    .join("<br><br>"); // hand off to htmlToText for the rest of the pipeline
  return htmlToText(normalized)?.replace(/ {2,}/g, " ") ?? null;
}

// "No photo available" placeholder detection lives in one shared place so the
// UI, overnight scout, and prune script all agree with the adapters.
export { isPlaceholderPhotoUrl } from "@/lib/photo";

/** Obvious non-dog breed/species words, as a belt-and-suspenders species filter. */
const NON_DOG_PATTERN =
  /domestic\s+(short|medium|long)\s*hair|\bdsh\b|\bdlh\b|\bdmh\b|\bcat\b|\bkitten\b|\brabbit\b|\bbunny\b|guinea\s*pig|\bbird\b|\bparakeet\b|\bchicken\b|\bgoat\b|\bpig\b|\bhamster\b|\brat\b|\bturtle\b|\btortoise\b|\bsnake\b|\blizard\b/i;

export function looksLikeNonDog(breedOrSpecies: string | null | undefined): boolean {
  if (!breedOrSpecies) return false;
  return NON_DOG_PATTERN.test(breedOrSpecies);
}
