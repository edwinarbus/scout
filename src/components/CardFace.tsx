"use client";

import type { DogView } from "@/lib/dogView";
import { wearOf } from "./motion";
import { DogPhoto, fmtAge } from "./ui";

/**
 * The face of a Scout trading card — ONE component shared by the flying sift
 * cards, the laid shortlist cards, and the front of every grid card, so the
 * view-transition morph from swirl → table → grid reads as one continuous
 * physical card.
 *
 * The front is intentionally quiet: the photo (recessed into the cardstock
 * like a real printed inset), the name, and one line of vitals. The only
 * badge is a rare "just arrived" flag. Status and fit live on the back.
 */
export default function CardFace({
  dog,
  showBadges = false,
  showStats = true,
  hideText = false,
}: {
  dog: DogView;
  /** Show the "new" flag — on for grid cards, off for tiny flying cards. */
  showBadges?: boolean;
  showStats?: boolean;
  /** Photo only — used for the profile modal's transitional FRONT face, whose
   *  fixed-px text would otherwise scale to a mismatched size during the
   *  open/close morph. The dossier + grid card carry the real text. */
  hideText?: boolean;
}) {
  const stats = [
    fmtAge(dog.ageMonthsEstimate, dog.ageRaw),
    dog.sex && dog.sex !== "unknown" ? dog.sex : null,
    dog.weightLbsEstimate ? `${dog.weightLbsEstimate} lbs` : dog.sizeNormalized,
  ]
    .filter(Boolean)
    .join(" · ");
  const breed = dog.breedNormalized || dog.breedRaw || null;
  const wear = wearOf(dog.id);

  return (
    <div className="scout-card scout-gloss flex h-full w-full flex-col rounded-[18px] bg-[linear-gradient(160deg,#fff,#faf6ee)] p-[4px] [container-type:inline-size]">
      {/* used-card wear — stable per dog, subtle */}
      {wear.bent && <span aria-hidden className={`scout-bend scout-bend-${wear.bent}`} />}
      {wear.crease && (
        <span
          aria-hidden
          className="scout-crease"
          style={{ left: `${wear.creaseX}%`, transform: `rotate(${wear.creaseAngle}deg)` }}
        />
      )}
      {wear.scuff && (
        <span
          aria-hidden
          className="scout-scuff"
          style={{ left: `${wear.scuffX}%`, top: `${wear.scuffY}%` }}
        />
      )}

      {/* the photo, recessed into the cardstock (inset ring reads as depth) */}
      <div className="scout-inset relative w-full flex-1 overflow-hidden rounded-[13px] bg-cream-100">
        <DogPhoto
          src={dog.primaryPhotoUrl}
          alt={dog.name ?? "dog"}
          className="absolute inset-0 h-full w-full"
        />

        {showBadges && dog.isNew && (
          <span className="absolute left-2 top-2 z-[3] rounded-full bg-honey-400/95 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-900 shadow-sm ring-1 ring-black/5">
            Just arrived
          </span>
        )}

        {/* name plate embedded along the photo's lower edge (omitted on the
            profile modal's transitional front face, which is photo-only) */}
        {!hideText && (
        // text-left is explicit, not just the default — the shortlist fan sits
        // inside a text-center section (for the heading above it), which would
        // otherwise cascade down and center this nameplate instead of the name
        // reading bottom-LEFT everywhere the card appears (sift, fan, grid).
        <div className="scout-nameplate absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/80 via-black/35 to-transparent px-[6cqw] pb-[3.5cqw] pt-[16cqw] text-left">
          {/* sizes scale with the card WIDTH (cqw) so the name fits whether it's
              a big grid card or a tiny flying sift card */}
          <p className="truncate font-display text-[9cqw] font-bold leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
            {dog.name ?? "Unnamed"}
          </p>
          {showStats && breed && (
            <p className="truncate text-[6.3cqw] font-semibold capitalize leading-tight text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
              {breed}
            </p>
          )}
          {showStats && stats && (
            <p className="truncate text-[6cqw] font-medium leading-tight text-white/75">{stats}</p>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
