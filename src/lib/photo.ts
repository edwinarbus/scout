/**
 * Shared photo-quality helpers — used by ingest adapters, the browser UI, the
 * overnight scout, and the prune maintenance script, so "is this a real dog
 * photo?" is decided the same way everywhere.
 *
 * Two kinds of non-photos slip in from shelter systems:
 *  1. URLs that name themselves as placeholders ("no_pic", "coming-soon", …) —
 *     caught by pattern before we ever fetch them.
 *  2. URLs that look fine but *serve* a generic "image available soon" graphic
 *     (petharbor.com redirects missing photos to a fixed 160×120 no_pic_d.jpg).
 *     Those can only be caught by their resolved dimensions (client, on load) or
 *     by following the redirect (server, in the prune script).
 */

/** Placeholder / "no photo" URL patterns, incl. petharbor's no_pic redirect target. */
export const PLACEHOLDER_PHOTO_PATTERN =
  /no[-_ ]?(image|pic|photo)|nopic|placeholder|default[-_.]|image[-_ ]?coming|(photo|image|coming)[-_ ]?soon|generic\.(svg|png|jpe?g)/i;

export function isPlaceholderPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return PLACEHOLDER_PHOTO_PATTERN.test(url);
}

/**
 * Known placeholder graphics by their exact pixel size. Real dog photos won't
 * match these fixed dimensions, so an <img> that loads at one of these sizes is
 * a "no photo" graphic in disguise.
 */
export const PLACEHOLDER_DIMENSIONS: ReadonlyArray<readonly [number, number]> = [
  [160, 120], // petharbor.com/Images/no_pic_d.jpg — LA Animal Services & friends
  [232, 246], // 24petconnect.com/image/<id> "No Image Available" card — SF ACC, Santa Cruz & friends
  [515, 347], // petharbor's cartoon "NO PHOTO AVAILABLE" card (served 200, no redirect)
];

export function isPlaceholderDimension(width: number, height: number): boolean {
  return PLACEHOLDER_DIMENSIONS.some(([w, h]) => width === w && height === h);
}
