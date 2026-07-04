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
