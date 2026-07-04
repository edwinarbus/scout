"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scout — the product mascot. A little sitting dog drawn as layered flat
 * vector (no external assets), shiba-style: TWO pointed ears sticking up
 * (with inner-ear detail), an oval skull with small cheek-fur tufts, a cream
 * face mask holding the eyes/nose/smile, a seated body with splayed haunches
 * and two cream front legs, a green collar with a gold tag, and a tail that
 * curves up off the hip.
 *
 * Idle life is SUBTLE: a slow breath, a blink every ~5s, an occasional flick
 * of the left ear, and a tail that rests still then wags in a short happy
 * burst every few seconds (globals.css; all disabled under
 * prefers-reduced-motion). Decorative only — aria-hidden.
 *
 * Symmetry rule: the design mirrors around x=75 — mirrored features (ears,
 * eyes, haunches, legs) must stay exact mirrors or the dog reads "off"/fake.
 *
 * Interactive: hover wags the tail; clicking "pets" it and the head nods.
 *
 * Searching mode (`searching`): the dog raises its front paws, pulls out big
 * cartoon binoculars, and scans left-and-right DOWN at the cards swirling
 * below — with comically magnified eyes drawn on the front of the lenses
 * (globals.css: scout-scan / scout-pupil-dart).
 */
export default function ScoutMascot({
  className = "",
  searching = false,
}: {
  className?: string;
  searching?: boolean;
}) {
  const [petting, setPetting] = useState(false);
  const petTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (petTimer.current) clearTimeout(petTimer.current); }, []);

  const pet = () => {
    setPetting(true);
    if (petTimer.current) clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => setPetting(false), 950);
  };

  return (
    <svg
      viewBox="0 0 150 150"
      className={`scout-mascot ${petting ? "is-petting" : ""} ${searching ? "is-searching" : ""} ${className}`}
      role="img"
      aria-hidden
      focusable="false"
      onClick={pet}
    >
      <defs>
        <linearGradient id="scout-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8ad63" />
          <stop offset="100%" stopColor="#d5963f" />
        </linearGradient>
        <linearGradient id="scout-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eeb56c" />
          <stop offset="100%" stopColor="#e0a253" />
        </linearGradient>
        {/* binocular barrel body — a metal tube lit along its top edge */}
        <linearGradient id="scout-barrel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a5a63" />
          <stop offset="52%" stopColor="#333f46" />
          <stop offset="100%" stopColor="#232d33" />
        </linearGradient>
        {/* the glass lens face — sky-blue glass with a bright upper-left */}
        <radialGradient id="scout-lens" cx="35%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#e8f6ff" />
          <stop offset="55%" stopColor="#b5dcf0" />
          <stop offset="100%" stopColor="#8fc3e0" />
        </radialGradient>
      </defs>

      {/* no ground shadow — this is a flat logo mark beside the wordmark, not a
          creature standing on a surface (a cast shadow read as "floating") */}
      <g className="scout-breathe">
        {/* tail — curves up off the right hip; wags in occasional bursts */}
        <g className="scout-wag">
          <path
            d="M100 120 C 116 122 127 111 126 95 C 125.5 88 119 87 117 92 C 119 102 112 110 100 112 Z"
            fill="#cf9040"
          />
        </g>

        {/* seated body — torso first, then smaller haunches tucked at the
            sides (thighs in front), rear paws peeking beside the front legs */}
        <ellipse cx="75" cy="103" rx="27" ry="25" fill="url(#scout-body)" />
        <ellipse cx="52" cy="122" rx="15" ry="15" fill="url(#scout-body)" />
        <ellipse cx="98" cy="122" rx="15" ry="15" fill="url(#scout-body)" />
        <ellipse cx="53" cy="139" rx="7.5" ry="4.5" fill="#f7e6c8" />
        <ellipse cx="97" cy="139" rx="7.5" ry="4.5" fill="#f7e6c8" />

        {/* two clearly separated cream front legs + paws (no chest patch —
            the collar + tag own that zone; a patch there read as "pants").
            While searching they stay put through the raise's delay, then tuck
            away (scout-legs-tuck) exactly as the paws lift the binoculars up —
            so the dog is never legless during the pause. */}
        <g className="scout-front-legs">
          <rect x="63" y="104" width="10" height="36" rx="5" fill="#f7e6c8" />
          <rect x="77" y="104" width="10" height="36" rx="5" fill="#f7e6c8" />
          <ellipse cx="68" cy="140" rx="7" ry="4.5" fill="#f7e6c8" />
          <ellipse cx="82" cy="140" rx="7" ry="4.5" fill="#f7e6c8" />
        </g>

        {/* collar — clean two-tone band right under the chin, gold tag on a loop.
            Drawn BEFORE the head group so the head and, crucially, the raised
            binocular ARMS paint OVER it — the cream arms must never slip behind
            the collar band. */}
        <path d="M56 82 C 64 89 86 89 94 82 L94 90 C 86 97 64 97 56 90 Z" fill="#1c8047" />
        <path d="M56 88.5 C 64 95.5 86 95.5 94 88.5 L94 90 C 86 97 64 97 56 90 Z" fill="#12592f" />
        <circle cx="75" cy="92.5" r="1.7" fill="none" stroke="#b9c0c5" strokeWidth="1.2" />
        <circle cx="75" cy="98" r="5.2" fill="#ffcf4d" stroke="#e0ab2c" strokeWidth="1.3" />
        <circle cx="73.4" cy="96.4" r="1.3" fill="#ffffff" fillOpacity="0.7" />

        {/* HEAD — everything from the ears down to the blush nods down when the
            dog is petted (see .scout-headgroup) */}
        <g className="scout-headgroup">
        {/* EARS — two pointed ears up, exact mirrors, tucked behind the skull.
            The left one flicks occasionally. */}
        <g className="scout-ear">
          <path d="M48 38 C 41 24 43 9 52 4 C 60 9 64 23 61 37 Z" fill="#c88a43" />
          <path d="M52 33 C 47 22 48 13 53 9 C 57 13 59 22 57 32 Z" fill="#e2a37e" />
        </g>
        <path d="M102 38 C 109 24 107 9 98 4 C 90 9 86 23 89 37 Z" fill="#c88a43" />
        <path d="M98 33 C 103 22 102 13 97 9 C 93 13 91 22 93 32 Z" fill="#e2a37e" />

        {/* skull — oval with a slightly flatter chin */}
        <path
          d="M75 16 C 96 16 109 30 109 50 C 109 68 95 80 75 80 C 55 80 41 68 41 50 C 41 30 54 16 75 16 Z"
          fill="url(#scout-head)"
        />

        {/* cream MUZZLE patch only (shiba-style) — the eyes stay on the tan */}
        <path
          d="M75 50 C 85 50 91 57 91 64 C 91 72 84 77 75 77 C 66 77 59 72 59 64 C 59 57 65 50 75 50 Z"
          fill="#f7e6c8"
        />

        {/* eyes (blink) on the tan head, just above the muzzle corners. The
            left eye is its own group so it can close into a wink when petted. */}
        <g className="scout-blink">
          <g className="scout-eye-l">
            <ellipse cx="58" cy="45" rx="4.5" ry="5.5" fill="#2a2320" />
            <circle cx="59.5" cy="43" r="1.6" fill="#ffffff" />
            <circle cx="56.6" cy="46.6" r="0.8" fill="#ffffff" fillOpacity="0.6" />
          </g>
          <ellipse cx="92" cy="45" rx="4.5" ry="5.5" fill="#2a2320" />
          <circle cx="93.5" cy="43" r="1.6" fill="#ffffff" />
          <circle cx="90.6" cy="46.6" r="0.8" fill="#ffffff" fillOpacity="0.6" />
        </g>
        {/* the wink — a happy closed-eye arc shown over the left eye on a pet */}
        <path
          className="scout-wink"
          d="M53 46 C 55.5 42.5 60.5 42.5 63 46"
          stroke="#2a2320"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />

        {/* nose at the muzzle top, smile, little tongue */}
        <path
          d="M75 54.5 C 71.5 54.5 69.5 56.5 69.5 58.5 C 69.5 61 72 62.5 75 62.5 C 78 62.5 80.5 61 80.5 58.5 C 80.5 56.5 78.5 54.5 75 54.5 Z"
          fill="#2a2320"
        />
        <ellipse cx="72.6" cy="56.8" rx="1.6" ry="1" fill="#ffffff" fillOpacity="0.8" />
        {/* idle mouth — a gentle closed smile with a peek of tongue */}
        <g className="scout-mouth-idle">
          <path
            d="M75 62.5 C 75 67 71 69 67.5 67 M75 62.5 C 75 67 79 69 82.5 67"
            stroke="#2a2320"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M71.5 68 C 71.5 72.5 78.5 72.5 78.5 68 Z" fill="#f2889b" />
        </g>
        {/* happy mouth — a big open smile with the tongue lolling out, shown on
            a pet. Drawn dark cavity → tongue → glossy highlight. */}
        <g className="scout-mouth-happy">
          <path
            d="M65.5 62 C 70 65.5 80 65.5 84.5 62 C 84 71 79 77.5 75 77.5 C 71 77.5 66 71 65.5 62 Z"
            fill="#3a2320"
          />
          <path
            d="M69 71 C 69 79.5 71.5 81 75 81 C 78.5 81 81 79.5 81 71 C 81 73.5 75 74.5 75 74.5 C 75 74.5 69 73.5 69 71 Z"
            fill="#f4899b"
          />
          <path d="M75 74.5 L 75 80.5" stroke="#db6e85" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M68 63 C 71.5 65 78.5 65 82 63 L 81 65 C 78 66.5 72 66.5 69 65 Z" fill="#ffffff" fillOpacity="0.9" />
        </g>
        {/* soft cheek blush on the tan */}
        <ellipse cx="50" cy="57" rx="3.6" ry="2.4" fill="#f0a98f" fillOpacity="0.4" />
        <ellipse cx="100" cy="57" rx="3.6" ry="2.4" fill="#f0a98f" fillOpacity="0.4" />

        {/* SEARCHING: chunky, TOY-LIKE 3D binoculars projecting out from the
            face in slight three-quarter perspective. Built in depth layers:
            (1) head is already behind → (2) rear tube bodies + eyecups + side
            planes → (3) thick front rims + inset dark lenses + glass → (4) paws
            wrapping the lower-outer sides → (5) glass highlights on top. The
            whole rig raises to the eyes (scout-binoc-raise) then scans. The
            front lenses sit a touch RIGHT of the eyecups (the tubes point
            slightly aside), so you read real barrel length + perspective. */}
        {searching && (
          <g className="scout-binoc">
            {/* arms — cream, rising from the body to grip the LOWER-OUTER of the
                barrels; they end below the lens center, so no cream ever shows
                above the lenses */}
            <path d="M66 110 C 57 105 47 92 51 63" stroke="#f7e6c8" strokeWidth="8.5" strokeLinecap="round" fill="none" />
            <path d="M84 110 C 93 105 104 92 101 63" stroke="#f7e6c8" strokeWidth="8.5" strokeLinecap="round" fill="none" />

            {/* barrel tube bodies — chunky rounded cylinders (lit top → dark
                bottom); the round-rect ends read as barrel + eyecup */}
            <rect x="48.5" y="39" width="21" height="27" rx="10.5" fill="url(#scout-barrel)" />
            <rect x="82.5" y="39" width="21" height="27" rx="10.5" fill="url(#scout-barrel)" />

            {/* top bridge joining the barrel tops (behind the lenses) */}
            <rect x="61" y="39.5" width="30" height="8" rx="4" fill="url(#scout-barrel)" />
            <ellipse cx="76" cy="41.6" rx="12" ry="1.7" fill="#5a6a72" opacity="0.5" />

            {/* refined eyecups pressed to the face (the rubber cups at the eyes) —
                a soft dark opening with a faint lit rim */}
            <ellipse cx="59" cy="40" rx="8.3" ry="3.4" fill="#141c21" />
            <ellipse cx="59" cy="39.4" rx="8.3" ry="2.9" fill="none" stroke="#3a4750" strokeWidth="0.8" opacity="0.55" />
            <ellipse cx="93" cy="40" rx="8.3" ry="3.4" fill="#141c21" />
            <ellipse cx="93" cy="39.4" rx="8.3" ry="2.9" fill="none" stroke="#3a4750" strokeWidth="0.8" opacity="0.55" />

            {/* CIRCULAR front lenses — thick rim, inset dark ring, sky-blue glass */}
            <circle cx="59" cy="54" r="11.5" fill="url(#scout-barrel)" />
            <circle cx="59" cy="54" r="11.5" fill="none" stroke="#0f161a" strokeWidth="1.4" />
            <circle cx="59" cy="54" r="8.6" fill="#121a1f" />
            <circle cx="59" cy="54" r="7" fill="url(#scout-lens)" />
            <circle cx="93" cy="54" r="11.5" fill="url(#scout-barrel)" />
            <circle cx="93" cy="54" r="11.5" fill="none" stroke="#0f161a" strokeWidth="1.4" />
            <circle cx="93" cy="54" r="8.6" fill="#121a1f" />
            <circle cx="93" cy="54" r="7" fill="url(#scout-lens)" />

            {/* central hinge / focus — bridges the two barrels IN FRONT so they
                read as ONE connected binocular, with a little focus knob */}
            <rect x="67" y="45" width="18" height="15" rx="5.5" fill="url(#scout-barrel)" />
            <ellipse cx="76" cy="47.4" rx="6" ry="1.6" fill="#5f6f77" opacity="0.6" />
            <circle cx="76" cy="54" r="3.6" fill="#1f282d" />
            <circle cx="74.8" cy="53" r="1.3" fill="#5a6a72" opacity="0.7" />

            {/* paws gripping the lower-outer edge (BELOW the lens center) */}
            <ellipse cx="51" cy="62" rx="5.6" ry="4.8" fill="#f7e6c8" />
            <ellipse cx="101" cy="62" rx="5.6" ry="4.8" fill="#f7e6c8" />
            <path d="M48 60.5 v4 M51 60 v5 M54 60.5 v4" stroke="#e5d2ac" strokeWidth="0.9" strokeLinecap="round" opacity="0.65" />
            <path d="M98 60.5 v4 M101 60 v5 M104 60.5 v4" stroke="#e5d2ac" strokeWidth="0.9" strokeLinecap="round" opacity="0.65" />

            {/* glass shine — a small crescent + glint nestled INSIDE the upper-
                left of each glass circle (r7 @ cy54), not touching the rim */}
            <path d="M55.5 52.5 A 4.6 4.6 0 0 1 59 49.3" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
            <path d="M89.5 52.5 A 4.6 4.6 0 0 1 93 49.3" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
            <circle cx="56.6" cy="51" r="1.3" fill="#ffffff" opacity="0.85" />
            <circle cx="90.6" cy="51" r="1.3" fill="#ffffff" opacity="0.85" />
          </g>
        )}
        </g>
      </g>
    </svg>
  );
}

/**
 * A minimal Scout logo mark — a friendly dog head with two pointed ears up
 * (matching the mascot) in a single color via currentColor. Clean and iconic;
 * no emoji, no paw blob.
 */
export function ScoutLogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
    >
      {/* two perked ears up — chunky with rounded tips (dog, not cat) */}
      <path d="M8.2 13.5 C 6.2 8.5 6.8 4.5 9.6 3 C 12.6 4.5 14.4 8 14.8 12 Z" fill="currentColor" />
      <path d="M23.8 13.5 C 25.8 8.5 25.2 4.5 22.4 3 C 19.4 4.5 17.6 8 17.2 12 Z" fill="currentColor" />
      {/* head */}
      <path
        d="M16 8 C 21.5 8 25.5 12 25.5 17.2 C 25.5 22.4 21.5 26 16 26 C 10.5 26 6.5 22.4 6.5 17.2 C 6.5 12 10.5 8 16 8 Z"
        fill="currentColor"
      />
      {/* eyes + muzzle knocked out for a clean silhouette read */}
      <circle cx="12.6" cy="16.4" r="1.6" fill="var(--color-cream-50)" />
      <circle cx="19.4" cy="16.4" r="1.6" fill="var(--color-cream-50)" />
      <path
        d="M16 19.2c-1.7 0-3 1.2-3 2.7 0 1.4 1.4 2.4 3 2.4s3-1 3-2.4c0-1.5-1.3-2.7-3-2.7Z"
        fill="var(--color-cream-50)"
      />
      <circle cx="16" cy="20.2" r="1.15" fill="currentColor" />
    </svg>
  );
}
