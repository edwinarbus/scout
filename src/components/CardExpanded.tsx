"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DogView } from "@/lib/dogView";
import type { UserDogStatus } from "@/lib/types";
import CardFace from "./CardFace";
import PhotoCarousel from "./PhotoCarousel";
import BreedTip from "./BreedTip";
import { LONG_STAY_DAYS, STATUS_LABELS, fmtAge, fmtStay, statusGroup } from "./ui";
import { isSaved, toggleSaved as toggleSavedStore } from "@/lib/savedStore";

/**
 * The full profile is the card TURNED OVER. Clicking a grid card, we lift it
 * out of its slot and — in ONE motion — move it to center while it flips and
 * grows into the dossier back: the dog's photo as hero, a concise decision
 * summary, and the shelter's own words. Closing reverses the same arc: the
 * card flips back to its front, shrinks, and settles into its grid slot.
 */

const EASE = "cubic-bezier(0.42, 0, 0.24, 1)"; // controlled pick-up-and-place

/** How long the flip (and its reverse) takes — the front-face fade below is
 *  timed to it. */
const FLIP_MS = 700;

/** The flip's easing — fastest right at the edge-on apex, so lift, travel,
 *  flip, and growth read as one continuous motion that lands soft. The
 *  front-face fade below MUST use this exact curve too: its hard cut is
 *  keyed to keyframe offset 0.5 (the apex), and that offset only lands at
 *  the same WALL-CLOCK moment as the card's own apex if both animations are
 *  eased identically. Mismatched easing (this curve vs the fade's previous
 *  default linear) let the front face stay opaque past the point the card
 *  had already turned edge-on, bleeding it through the dossier mid-flip. */
const FLIP_EASING = "cubic-bezier(0.5, 0.05, 0.15, 1)";

/** The transitional front face's opacity ACROSS the 700ms flip: shown for the
 *  first half (card 0→90°, the photo you clicked turning), then gone for the
 *  second half (90→180°, the dossier now facing you). The switch is a hard cut
 *  right at the edge-on apex (offset 0.5), where the card has zero visible
 *  width — so it's invisible. This replaces backface-visibility, which Safari
 *  doesn't honor on this preserve-3d flip: the turned-away front kept getting
 *  painted and bled through the dossier's underside DURING the flip (the two-
 *  tone Adopt button). Played forward for open, reversed for close so the front
 *  fades back in only once the card turns past the apex on its way home. */
const FLIP_FACE_FADE: Keyframe[] = [
  { opacity: 1, offset: 0 },
  { opacity: 1, offset: 0.49 },
  { opacity: 0, offset: 0.5 },
  { opacity: 0, offset: 1 },
];

interface Geo {
  dx: number;
  dy: number;
  s: number;
  tilt: string;
}

/**
 * The three poses of the turn, sharing ONE transform-function list
 * (translate → scale → rotateY → rotate) so the browser interpolates them as a
 * smooth rotation, not a matrix flip:
 *  · origin — sitting exactly over the grid card (front up, at the card's tilt)
 *  · apex   — lifted off the table, edge-on (rotateY 90° hides the face swap)
 *  · rest   — centered, full size, turned all the way to the dossier
 */
function poses({ dx, dy, s, tilt }: Geo) {
  const lift = 40 + Math.min(140, Math.hypot(dx, dy) * 0.14); // rises more the farther it travels
  return {
    origin: `translate(${dx}px, ${dy}px) scale(${s.toFixed(4)}) rotateY(0deg) rotate(${tilt})`,
    apex: `translate(${(dx * 0.5).toFixed(1)}px, ${(dy * 0.5 - lift).toFixed(1)}px) scale(${((s + 1) / 2).toFixed(4)}) rotateY(90deg) rotate(0deg)`,
    rest: "translate(0px, 0px) scale(1) rotateY(180deg) rotate(0deg)",
  };
}

/** A little paw print for the Adopt button's hover march. */
function PawGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[26px] w-[26px] shrink-0" fill="currentColor" aria-hidden>
      <ellipse cx="12" cy="16" rx="4.4" ry="3.6" />
      <ellipse cx="5.6" cy="10.6" rx="1.9" ry="2.5" />
      <ellipse cx="9.7" cy="7.2" rx="2" ry="2.7" />
      <ellipse cx="14.3" cy="7.2" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="10.6" rx="1.9" ry="2.5" />
    </svg>
  );
}

export default function CardExpanded({
  dog,
  matchScore,
  matchReasons,
  matchCaveats,
  originRect,
  plain = false,
  onClose,
  onSetStatus,
}: {
  dog: DogView;
  matchScore?: number;
  matchReasons?: string[];
  matchCaveats?: string[];
  originRect?: DOMRect | null;
  /** Plain mode: no trading-card flip — just the dossier, faded in/out. Used
   *  when opened from a map/list listing (there's no card to flip). */
  plain?: boolean;
  onClose: () => void;
  onSetStatus: (id: string, status: UserDogStatus | null) => Promise<void>;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const adoptRef = useRef<HTMLAnchorElement | null>(null);
  const geo = useRef<Geo | null>(null);
  /** The modal card's UNtransformed rect, captured once at open. Close remeasures
   *  the grid slot against this so it lands on the card's true RESTING position
   *  (the slot the prop captured was mid-hover — lifted/scaled — so replaying to
   *  it left the card hovering ~10px high, then snapping down on reveal). */
  const finalRect = useRef<DOMRect | null>(null);
  const originEl = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  /** Measure-and-animate must run exactly once — a re-run would remeasure the
   *  element MID-transform (wrong size) and restart the animation. */
  const didOpenRef = useRef(false);
  const [backdropOn, setBackdropOn] = useState(false);
  const [closing, setClosing] = useState(false); // plain-mode fade-out

  useEffect(() => setBackdropOn(true), []);

  // While the profile is up, scrolling belongs to the dossier ONLY. Wheel /
  // touch anywhere else on the overlay is swallowed, so the grid behind can't
  // drift (which would also desync the card's landing slot on close). The
  // dossier itself is overscroll-contained, so hitting its ends never chains
  // into the page. Layout is untouched — no scrollbar jump.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const guard = (e: Event) => {
      if (scrollRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
    };
    overlay.addEventListener("wheel", guard, { passive: false });
    overlay.addEventListener("touchmove", guard, { passive: false });
    return () => {
      overlay.removeEventListener("wheel", guard);
      overlay.removeEventListener("touchmove", guard);
    };
  }, []);

  // OPEN — lift out of the grid slot and, in one motion, move to center while
  // flipping + growing. The start pose is committed inline (reflow) BEFORE the
  // animation, so the very first painted frame is the small card over its slot
  // — never a flash of the full centered card.
  useLayoutEffect(() => {
    // plain mode fades in via CSS — no measure/flip machinery
    if (plain) {
      adoptRef.current?.focus({ preventScroll: true });
      return;
    }
    const el = cardRef.current;
    if (!el) return;

    originEl.current = originRect ? document.getElementById(`card-${dog.id}`) : null;
    if (originEl.current) originEl.current.style.visibility = "hidden";

    if (!didOpenRef.current) {
      didOpenRef.current = true;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const final = el.getBoundingClientRect(); // fresh mount → untransformed = true size
      finalRect.current = final;

      if (!originRect || reduce || final.height === 0) {
        el.style.transition = "none";
        el.style.transform = "rotateY(180deg) scale(0.96)";
        el.style.opacity = "0";
        void el.offsetWidth;
        el.style.transition = reduce
          ? "opacity 0.16s ease"
          : `transform 0.34s ${EASE}, opacity 0.34s ease`;
        el.style.transform = "rotateY(180deg) scale(1)";
        el.style.opacity = "1";
        // This branch starts already turned to the back (rotateY 180), so the
        // front face is never shown — hide it outright (see FLIP_FACE_FADE).
        if (frontRef.current) frontRef.current.style.opacity = "0";
      } else {
        const s = originRect.height / final.height;
        const dx = originRect.left + originRect.width / 2 - (final.left + final.width / 2);
        const dy = originRect.top + originRect.height / 2 - (final.top + final.height / 2);
        const liftable = originEl.current?.closest(".scout-liftable");
        const tilt =
          (liftable && getComputedStyle(liftable).getPropertyValue("--tilt").trim()) || "0deg";
        geo.current = { dx, dy, s, tilt };

        const p = poses(geo.current);
        el.style.opacity = "1";
        el.style.transform = p.origin; // committed as the first painted frame
        void el.offsetWidth;
        // ONE swoop. No per-keyframe easing — that decelerated to a dead stop
        // at the apex (the "flip halfway, pause, then grow" jank). A single
        // whole-animation curve is FASTEST right at the edge-on apex, so lift,
        // travel, flip, and growth read as one continuous motion that lands soft.
        el.animate(
          [
            { transform: p.origin },
            { transform: p.apex, offset: 0.5 },
            { transform: p.rest },
          ],
          { duration: FLIP_MS, easing: FLIP_EASING, fill: "both" }
        );
        // Fade the transitional front face out exactly at the edge-on apex, in
        // lockstep with the flip — so it's gone the instant the dossier starts
        // to face us and never bleeds through the underside mid-flip. (See
        // FLIP_FACE_FADE — this replaces the unreliable backface-visibility.)
        // Must share FLIP_EASING with the transform above: offset 0.5 in each
        // only coincides in wall-clock time if both are eased identically.
        frontRef.current?.animate(FLIP_FACE_FADE, { duration: FLIP_MS, easing: FLIP_EASING, fill: "both" });
      }
      adoptRef.current?.focus({ preventScroll: true });
    }

    const origin = originEl;
    const closing = closingRef;
    return () => {
      const o = origin.current;
      if (!o) return;
      o.style.visibility = "";
      // A normal close reveals + fades the shadow/plate in on the (persistent)
      // grid card; yanking those classes here would cancel that fade and pop
      // them to full. On any OTHER teardown, strip them so the grid card isn't
      // left shadowless/plateless.
      if (!closing.current) {
        o.classList.remove("scout-reveal-arming");
        o.querySelector<HTMLElement>(".scout-card")?.classList.remove("scout-card-reveal-hidden");
        o.querySelector<HTMLElement>(".scout-nameplate")?.classList.remove("scout-nameplate-hidden");
      }
    };
  }, [dog.id, originRect]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = cardRef.current;
    // Remeasure the grid slot NOW: the modal's backdrop has un-hovered the card,
    // so it's dropped back to its true resting spot (no hover lift/scale/tilt).
    // Replaying to the open-time `geo` (captured mid-hover) would land the card
    // ~10px high and then snap down the instant the real card is revealed. A
    // fresh measurement against the stored untransformed modal rect closes onto
    // exactly where the revealed card sits. Fall back to open-time geo if the
    // grid card or its rect is somehow unavailable.
    let g = geo.current;
    const oEl = originEl.current;
    const final = finalRect.current;
    if (oEl && final && g) {
      const r = oEl.getBoundingClientRect();
      if (r.height > 0) {
        g = {
          s: r.height / final.height,
          dx: r.left + r.width / 2 - (final.left + final.width / 2),
          dy: r.top + r.height / 2 - (final.top + final.height / 2),
          tilt: g.tilt,
        };
      }
    }
    setBackdropOn(false);

    // Restore the grid card + unmount together — the modal has been holding the
    // card's exact slot, so this is seamless. Synchronous (not rAF, which is
    // throttled in a backgrounded tab and would hang the profile open).
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const o = originEl.current;
      // The reverse flip ends EXACTLY at the grid card's slot/size/tilt (a true
      // mirror of the open), so the PHOTO reveals seamlessly. But the grid
      // card's shadow, printed border (.scout-card::before) and nameplate are
      // exclusive to it — the modal's front face is photo-only — so we must
      // fade those three IN as the card lands, or they pop (the flash).
      //
      // We COMMIT them to their hidden state instantly, while the card is
      // visible, with transitions armed OFF (.scout-reveal-arming) — then on
      // the next frame remove the arming + hidden classes so they transition IN
      // from that guaranteed baseline. Committing hidden while the card is still
      // invisible (the old pre-settle) was unreliable: Safari doesn't tick a
      // transition on a hidden element, so the "from" value was never actually
      // transparent and they flashed in on mobile.
      if (o) {
        const cardEl = o.querySelector<HTMLElement>(".scout-card");
        const plate = o.querySelector<HTMLElement>(".scout-nameplate");
        o.classList.add("scout-reveal-arming");
        cardEl?.classList.add("scout-card-reveal-hidden");
        plate?.classList.add("scout-nameplate-hidden");
        o.style.visibility = "";
        void o.offsetWidth; // commit the hidden state as the transition baseline
        requestAnimationFrame(() => {
          o.classList.remove("scout-reveal-arming"); // transitions back on
          cardEl?.classList.remove("scout-card-reveal-hidden");
          plate?.classList.remove("scout-nameplate-hidden"); // → clean 0.4s fade
        });
      }
      onClose();
    };
    // plain mode: just fade the card + backdrop out, then unmount
    if (plain) {
      setClosing(true);
      window.setTimeout(finish, 200);
      return;
    }

    if (!el || !g) return finish();

    const p = poses(g);
    // Close is the OPEN played in reverse — the SAME keyframes (origin → apex →
    // rest) with direction:"reverse", so it's a true mirror: the card turns back
    // around, scales down, and settles into its exact grid slot in one continuous
    // swoop. It ends at `origin` (grid slot, front-up), so restoring the real
    // grid card underneath is seamless. The grid card stays hidden until finish.
    el.animate(
      [
        { transform: p.origin },
        { transform: p.apex, offset: 0.5 },
        { transform: p.rest },
      ],
      {
        duration: FLIP_MS,
        easing: FLIP_EASING,
        fill: "both",
        direction: "reverse",
      }
    ).addEventListener("finish", finish, { once: true });
    // Mirror the front-face fade in reverse: it stays hidden while the dossier
    // faces us (180→90°), then fades back in at the apex to lead the card home
    // (90→0°) — so the front is never bleeding through the underside mid-flip,
    // yet the card is never invisible on its way down. Same FLIP_EASING as
    // above, so the fade's offset-0.5 cut lands at the same wall-clock moment
    // as the transform's apex — see the FLIP_EASING comment for why that
    // matters.
    frontRef.current?.animate(FLIP_FACE_FADE, {
      duration: FLIP_MS,
      easing: FLIP_EASING,
      fill: "both",
      direction: "reverse",
    });
    window.setTimeout(finish, FLIP_MS + 140); // safety net if the finish event is missed
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Heart state is owned by the local shortlist store (instant, persistent);
  // the server status is synced best-effort so the overnight watches still see it.
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(isSaved(dog.id)), [dog.id]);
  const toggleSaved = () => {
    const now = toggleSavedStore({
      id: dog.id,
      name: dog.name ?? null,
      photo: dog.primaryPhotoUrl ?? null,
      breed: dog.breedNormalized ?? dog.breedRaw ?? null,
      city: dog.city ?? null,
      url: dog.originalUrl,
    });
    setSaved(now);
    void onSetStatus(dog.id, now ? "saved" : null).catch(() => {});
  };

  const photos = dog.photoUrls?.length
    ? dog.photoUrls
    : dog.primaryPhotoUrl
      ? [dog.primaryPhotoUrl]
      : [];

  const breed = dog.breedNormalized ?? dog.breedRaw ?? null;
  const vitals = [
    fmtAge(dog.ageMonthsEstimate, dog.ageRaw),
    dog.sex && dog.sex !== "unknown" ? dog.sex : null,
    dog.weightLbsEstimate ? `${dog.weightLbsEstimate} lbs` : dog.sizeNormalized,
  ]
    .filter(Boolean)
    .join(" · ");

  const group = statusGroup(dog.statusNormalized);
  const dotColor =
    group === "available" ? "#2fa85c" : group === "pending" ? "#d99a1e" : group === "gone" ? "#8a97a0" : "#a1b2b8";
  const stay = fmtStay(dog.daysInShelter);
  const longStay = dog.daysInShelter != null && dog.daysInShelter >= LONG_STAY_DAYS;

  const reasons = (matchReasons ?? []).slice(0, 3);
  const caveats = matchCaveats ?? [];

  return (
    <div
      ref={overlayRef}
      className="scout-flip-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${dog.name ?? "Unnamed"} — full profile`}
    >
      <div
        className={`absolute inset-0 bg-ink-900/45 backdrop-blur-[2px] transition-opacity duration-[480ms] ease-out ${
          backdropOn ? "opacity-100" : "opacity-0"
        }`}
        onClick={close}
      />

      <div
        ref={plain ? undefined : cardRef}
        className={
          plain
            ? `scout-info-card relative flex h-[min(88vh,620px)] w-[min(94vw,880px)] flex-col overflow-hidden rounded-[20px] bg-[#fffdf7] shadow-2xl ring-1 ring-black/10 sm:flex-row ${closing ? "scout-info-out" : "scout-info-in"}`
            : "scout-flip-card relative h-[min(88vh,620px)] w-[min(94vw,880px)]"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* FRONT — the card you clicked, so the turn feels like one object.
            Photo-only (hideText): its fixed-px nameplate would scale to a
            mismatched tiny size during the open/close morph — the grid card and
            the dossier carry the real text, which fades in as the card lands.
            (Omitted in plain mode — no flip, so no front face.) */}
        {!plain && (
          <div ref={frontRef} className="scout-flip-face flex items-center justify-center" aria-hidden>
            <div className="aspect-[5/7] h-full max-w-full">
              <CardFace dog={dog} showBadges hideText />
            </div>
          </div>
        )}

        {/* THE DOSSIER — the card's back in flip mode; the whole card in plain
            mode (display:contents lets its children flow into the plain flex
            wrapper unchanged). */}
        <div
          className={
            plain
              ? "contents"
              : "scout-flip-face scout-flip-back scout-flip-plate flex flex-col overflow-hidden rounded-[20px] bg-[#fffdf7] sm:flex-row"
          }
        >
          {/* HERO photo */}
          <div className="relative h-[36%] w-full shrink-0 bg-cream-100 sm:h-full sm:w-[46%]">
            <PhotoCarousel photos={photos} alt={dog.name ?? "dog"} />
          </div>

          {/* DOSSIER — the whole column scrolls */}
          <div className="relative min-h-0 min-w-0 flex-1">
            <div ref={scrollRef} className="scout-scroll h-full overflow-y-auto overscroll-contain px-6 pb-6 pt-8">
              {/* name + vitals */}
              <div className="sm:pr-20">
                <h2 className="font-display text-[27px] font-extrabold leading-[1.05] text-ink-900">
                  {dog.name ?? "Unnamed"}
                </h2>
                <p className="mt-1.5 text-[13px] text-ink-500">
                  {vitals}
                  {breed ? (
                    <>
                      {vitals ? " · " : ""}
                      <BreedTip breed={breed} />
                    </>
                  ) : null}
                </p>
              </div>

              {/* availability + fit */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: dotColor }} />
                  {STATUS_LABELS[dog.statusNormalized]}
                  {stay ? ` · ${stay} in care` : ""}
                  {longStay ? " · long wait" : ""}
                </span>
                {matchScore != null && (
                  <span className="rounded-full bg-meadow-100 px-2.5 py-0.5 text-[12px] font-bold text-terra-600">
                    {Math.round(matchScore)} fit
                  </span>
                )}
              </div>

              {/* primary action — no arrow; paws march on hover */}
              <a
                ref={adoptRef}
                href={dog.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scout-adopt relative mt-4 flex w-full items-center justify-center overflow-hidden rounded-xl bg-terra-500 px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-terra-600"
              >
                {/* on hover, a dog walks across the button left→right: each
                    print lands in turn (alternating feet, toes pointing right),
                    the trail lingers, and the oldest tracks fade away */}
                <span aria-hidden className="scout-adopt-paws">
                  {Array.from({ length: 10 }).map((_, i) => {
                    const odd = i % 2 === 1;
                    const baseY = odd ? -74 : -26; // alternating high/low feet
                    const baseR = odd ? 82 : 98; // toes pointing along the walk
                    const jy = ((i * 37) % 11) - 5; // ±5% askew
                    const jr = ((i * 53) % 13) - 6; // ±6° askew
                    const js = 0.96 + ((i * 29) % 9) / 100; // 0.96–1.04 askew scale
                    return (
                      <span
                        key={i}
                        className="scout-paw-step"
                        style={
                          {
                            left: `${(i * 100) / 9}%`, // 0%→100%: first & last straddle the edges
                            animationDelay: `${i * 0.14}s`,
                            "--pty": `${baseY + jy}%`,
                            "--ptr": `${baseR + jr}deg`,
                            "--pts": js.toFixed(2),
                          } as React.CSSProperties
                        }
                      >
                        <PawGlyph />
                      </span>
                    );
                  })}
                </span>
                <span className="scout-adopt-label relative z-[1] transition-colors duration-300">
                  Adopt {dog.name ?? "this dog"}
                </span>
              </a>
              <p className="mt-1.5 text-[11.5px] text-ink-400">
                {dog.shelterLocationName ?? dog.shelterName ?? dog.source.name}
                {dog.city ? ` · ${dog.city}` : ""}
              </p>

              {/* decision summary */}
              {(reasons.length > 0 || caveats.length > 0) && (
                <div className="mt-4 space-y-2">
                  {reasons.map((r, i) => (
                    <p key={i} className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-700">
                      <span className="mt-px inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-meadow-100" aria-hidden>
                        <svg viewBox="0 0 20 20" className="h-3 w-3 text-terra-600" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4.5 10.5l3.2 3.2L15.5 6" />
                        </svg>
                      </span>
                      <span>{r}</span>
                    </p>
                  ))}
                  {caveats.length > 0 && (
                    <p className="flex items-start gap-2.5 text-[12.5px] leading-snug text-ink-500">
                      <span className="mt-px inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-100" aria-hidden>
                        <svg viewBox="0 0 20 20" className="h-3 w-3 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 5.5v5" />
                          <path d="M10 14.2v.2" />
                        </svg>
                      </span>
                      <span>Worth checking: {caveats.join(" · ")}</span>
                    </p>
                  )}
                </div>
              )}

              {/* the shelter's own words + a quiet photo note */}
              {dog.biographyRaw && (
                <div className="mt-5 border-t border-cream-200 pt-4">
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                    From the shelter
                  </p>
                  <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-700">
                    {dog.biographyRaw}
                  </p>
                </div>
              )}
              {dog.ai?.visualDescription && (
                <p className="mt-4 text-[12px] italic leading-relaxed text-ink-400">
                  Scout&apos;s read of the photo: {dog.ai.visualDescription}
                </p>
              )}
            </div>
          </div>

          {/* top-right: save (heart) + close. A sibling of the hero photo and
              the dossier text (not nested in either), so it's positioned
              against their shared box: on mobile (stacked) that box's top
              edge is the photo, so the buttons sit over the carousel; on
              desktop (side-by-side) it lands at the text column's top-right,
              same as before. White circles at all times (not just on hover)
              so the icons stay legible over any photo. */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleSaved}
              aria-pressed={saved}
              aria-label={saved ? "Saved" : "Save"}
              title={saved ? "Saved" : "Save"}
              className={`flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/5 transition ${
                saved ? "text-rose-500" : "text-ink-400 hover:text-rose-500"
              }`}
            >
              {/* Lucide heart — symmetric around the 24×24 center, so it sits
                  centered in the round button */}
              <svg viewBox="0 0 24 24" className={`h-[20px] w-[20px] transition-transform ${saved ? "scale-110" : ""} active:scale-90`} fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-500 shadow-md ring-1 ring-black/5 transition hover:text-ink-900"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
