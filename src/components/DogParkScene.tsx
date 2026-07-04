/**
 * The dog-park environment behind the landing hero — a layered, lit scene of
 * procedural SVG/CSS (no image assets). Depth comes from atmosphere, not
 * lines: pale haze ridges behind the horizon, gradient-shaded hills with a
 * soft crest light along each ridge, two-tone tree canopies lit from the sun
 * side, clip-shaded clouds (the
 * underside shade follows the cloud's own silhouette), a rim-lit rayless sun,
 * daisy clusters, and a two-layer blade edge along the bottom.
 *
 * Light contract: the sun lives top-right, so every highlight (cloud crowns,
 * canopy lobes, bush tops) sits up-right and every shade sits down-left —
 * flipped trees un-mirror their lighting so it never points the wrong way.
 *
 * Geometry contract (do not break): 2880×620 viewBox, bottom-anchored,
 * xMidYMax slice. Far-meadow crest at y 58–96 = the horizon (~40% viewport)
 * so the hero's dog sits ON the grass. Center band x 720–2160 is what normal
 * screens see (phones: x ≈ 1235–1645 — keep center flowers/specks there);
 * wings only appear on wide/ultrawide. Haze ridges stay ≥ y 60 so ultrawide
 * top-cropping (≈54 units at 32:9) never slices a fill. No thin crest
 * strokes — they read as stray lines; ridge light is a clipped gradient wash.
 * Purely decorative (aria-hidden).
 */

/** One 1440-wide strip of foreground grass blades; tiled + layered below. */
const BLADE_STRIP =
  "M0 560 Q 20 520 40 560 Q 60 516 80 560 Q 100 524 120 560 Q 140 512 160 560 Q 180 522 200 560 Q 220 514 240 560 Q 260 524 280 560 Q 300 516 320 560 Q 340 522 360 560 Q 380 512 400 560 Q 420 524 440 560 Q 460 516 480 560 Q 500 522 520 560 Q 540 514 560 560 Q 580 524 600 560 Q 620 516 640 560 Q 660 522 680 560 Q 700 512 720 560 Q 740 524 760 560 Q 780 516 800 560 Q 820 522 840 560 Q 860 514 880 560 Q 900 524 920 560 Q 940 516 960 560 Q 980 522 1000 560 Q 1020 512 1040 560 Q 1060 524 1080 560 Q 1100 516 1120 560 Q 1140 522 1160 560 Q 1180 514 1200 560 Q 1220 524 1240 560 Q 1260 516 1280 560 Q 1300 522 1320 560 Q 1340 512 1360 560 Q 1380 524 1400 560 Q 1420 516 1440 560 L1440 620 L0 620 Z";

/** Band silhouettes — three GENTLY rolling ridges, not flat bands, with their
 * crests spread across the width so the composition stays balanced: the far
 * ridge crowns on the LEFT, the mid ridge crowns in the CENTER, the front
 * ridge crowns on the RIGHT. Low amplitude on purpose — soft meadow rolls, not
 * mountains. (Crest-light clips reuse these exact paths.) */
const FAR_BAND =
  "M0 68 C 320 56 640 58 960 76 C 1280 90 1600 94 1920 90 C 2240 86 2560 88 2880 88 L2880 620 L0 620 Z";
const MID_BAND =
  "M0 236 C 360 230 720 222 1080 206 C 1300 196 1560 194 1800 202 C 2160 216 2520 230 2880 234 L2880 620 L0 620 Z";
const FRONT_BAND =
  "M0 360 C 360 364 760 366 1120 360 C 1480 354 1840 342 2200 332 C 2440 326 2680 330 2880 336 L2880 620 L0 620 Z";

export default function DogParkScene() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* sky — a vertical wash that hazes out right at the raised horizon */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #b7e0ff 0%, #cfeaff 22%, #e2f3ff 33%, #edf9ec 42%)",
        }}
      />
      {/* warm sunlight tint spilling from the upper right */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 48% at 84% 10%, rgba(255,214,120,0.42), rgba(255,214,120,0) 60%)",
        }}
      />

      {/* sun — layered glow + core with a lit rim; no rays, no arc marks */}
      <div className="absolute right-[6%] top-[6%] h-36 w-36 sm:h-44 sm:w-44">
        <svg viewBox="0 0 200 200" className="h-full w-full">
          <defs>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe08a" stopOpacity="0.9" />
              <stop offset="45%" stopColor="#ffd45e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ffd45e" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sunCore" cx="40%" cy="36%" r="66%">
              <stop offset="0%" stopColor="#ffeda2" />
              <stop offset="55%" stopColor="#ffd964" />
              <stop offset="100%" stopColor="#ffc531" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="96" fill="url(#sunGlow)" />
          <circle cx="100" cy="100" r="52" fill="url(#sunCore)" />
          {/* crisp lit rim on the disc edge */}
          <circle cx="100" cy="100" r="52" fill="none" stroke="#ffe9a3" strokeWidth="3" opacity="0.7" />
        </svg>
      </div>

      {/* distant birds — thin, light, two depths */}
      <svg
        className="scout-float absolute left-[20%] top-[11%] w-14 text-ink-500/30"
        viewBox="0 0 60 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        style={{ ["--float" as string]: "26px", ["--float-dur" as string]: "26s" }}
      >
        <path d="M2 12 Q 9 4.5 16 12 Q 23 4.5 30 12" />
        <path d="M33 15 Q 38.5 9.5 44 15 Q 49.5 9.5 55 15" opacity="0.65" strokeWidth="1.5" />
      </svg>

      {/* clouds — silhouette-clipped shading (the underside shade follows the
          cloud's own outline; the crown highlight sits sun-side). Farther
          clouds are smaller + fainter. */}
      {/* Each cloud is a DIFFERENT silhouette (v) and drifts on the wind at its
          own slow pace + distance (parallax) — always on screen, never leaving
          the sky bare. scout-cloud = a very slow, wide horizontal drift with a
          faint rise/fall. */}
      {/* Each cloud: a different silhouette (v), a different DRIFT SPEED (34s
          fast → 124s slow, wide spread), and its own squash/stretch proportions
          (--csx/--csy) so no two read as the same stamp. */}
      <Cloud id="a" v={0} className="scout-cloud absolute left-[5%] top-[11%] w-40 sm:w-48" style={{ ["--drift" as string]: "70px", ["--driftY" as string]: "-11px", ["--drift-dur" as string]: "34s", ["--csx" as string]: "1.14", ["--csy" as string]: "0.86" }} />
      <Cloud id="b" v={2} className="scout-cloud absolute right-[16%] top-[20%] w-24 opacity-95 sm:w-28" style={{ ["--drift" as string]: "-44px", ["--driftY" as string]: "8px", ["--drift-dur" as string]: "104s", ["--csx" as string]: "0.9", ["--csy" as string]: "1.1" }} />
      <Cloud id="c" v={1} className="scout-cloud absolute left-[34%] top-[6%] w-20 opacity-90" style={{ ["--drift" as string]: "56px", ["--driftY" as string]: "-6px", ["--drift-dur" as string]: "58s", ["--csx" as string]: "1.06", ["--csy" as string]: "0.95" }} />
      <Cloud id="d" v={4} className="scout-cloud absolute left-[57%] top-[15%] w-14 opacity-75" style={{ ["--drift" as string]: "-30px", ["--driftY" as string]: "10px", ["--drift-dur" as string]: "124s", ["--csx" as string]: "1.22", ["--csy" as string]: "0.8" }} />
      <Cloud id="e" v={3} className="scout-cloud absolute right-[6%] top-[30%] w-16 opacity-[0.65] sm:w-20" style={{ ["--drift" as string]: "62px", ["--driftY" as string]: "-8px", ["--drift-dur" as string]: "46s", ["--csx" as string]: "0.94", ["--csy" as string]: "1.05" }} />

      {/* a butterfly wandering over the meadow */}
      <div
        className="scout-float absolute left-[15%] top-[47%] hidden sm:block"
        style={{ ["--float" as string]: "40px", ["--float-dur" as string]: "12s" }}
      >
        <svg viewBox="0 0 28 26" className="w-6">
          <g className="scout-flutter">
            <path d="M13 12 C 10 4 1.6 2 1 8 C 0.6 12 6 15 13 14 Z" fill="#c9a6f2" />
            <path d="M13 14 C 7 14 2.4 17 3.6 21 C 4.8 23.8 10 22 13 16 Z" fill="#b48ceb" />
            <path d="M15 12 C 18 4 26.4 2 27 8 C 27.4 12 22 15 15 14 Z" fill="#c9a6f2" />
            <path d="M15 14 C 21 14 25.6 17 24.4 21 C 23.2 23.8 18 22 15 16 Z" fill="#b48ceb" />
          </g>
          <rect x="12.9" y="6.5" width="2.2" height="13.5" rx="1.1" fill="#4a3a63" />
          <circle cx="14" cy="5.6" r="1.6" fill="#4a3a63" />
          <path
            d="M13.2 4.6 C 11.8 3 10.6 2.2 9.4 2 M14.8 4.6 C 16.2 3 17.4 2.2 18.6 2"
            stroke="#4a3a63"
            strokeWidth="0.9"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </div>

      {/* hills — band anchored to the bottom; the far crest is the horizon.
          On mobile the wide viewBox + xMidYMax slice zooms hard to cover height,
          so an over-tall band shoves the horizon up near the sun and magnifies
          everything — keep it shorter there (horizon ~40%, the intended spot,
          with the crest still under the hero dog). Desktop shows more width, so
          it can stay taller. */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[66vh] w-full sm:h-[84vh]"
        viewBox="0 0 2880 620"
        preserveAspectRatio="xMidYMax slice"
        fill="none"
      >
        <defs>
          <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cbedbb" />
            <stop offset="100%" stopColor="#aede9c" />
          </linearGradient>
          <linearGradient id="hillMid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#97dc97" />
            <stop offset="100%" stopColor="#78c97e" />
          </linearGradient>
          <linearGradient id="hillFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#66c77c" />
            <stop offset="100%" stopColor="#4aab61" />
          </linearGradient>
          <linearGradient id="hillFore" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#47a45d" />
            <stop offset="100%" stopColor="#3a8b4f" />
          </linearGradient>
          {/* soft ridge light — clipped to each band so it hugs the crest */}
          <linearGradient id="crestGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="clipFar">
            <path d={FAR_BAND} />
          </clipPath>
          <clipPath id="clipMid">
            <path d={MID_BAND} />
          </clipPath>
          <clipPath id="clipFront">
            <path d={FRONT_BAND} />
          </clipPath>
        </defs>

        {/* atmospheric haze ridges — palest green-blue, peeking above the far
            crest at the wings only (center stays clean for the lockup) */}
        <path
          d="M0 74 C 200 62 420 64 640 78 C 720 83 780 88 830 92 L830 170 L0 170 Z"
          fill="#d7ebdc"
          opacity="0.8"
        />
        <path
          d="M2050 92 C 2150 86 2350 66 2560 62 C 2680 60 2800 64 2880 67 L2880 170 L2050 170 Z"
          fill="#d7ebdc"
          opacity="0.8"
        />

        {/* FAR MEADOW — the horizon; the hero lockup sits on this grass */}
        <path d={FAR_BAND} fill="url(#hillFar)" />
        <rect x="0" y="50" width="2880" height="64" fill="url(#crestGlow)" opacity="0.6" clipPath="url(#clipFar)" />
        {/* distant bushes riding the rolling far crest — three different dome
            shapes (v) so no two read alike, grounded by soft shadows, kept away
            from the center lockup */}
        <Bush x={200} y={62} s={1.05} v={0} />
        <Bush x={640} y={58} s={0.92} v={1} />
        <Bush x={960} y={76} s={1.2} v={2} />
        <Bush x={1900} y={90} s={1.12} v={2} />
        <Bush x={2240} y={86} s={0.95} v={0} />
        <Bush x={2560} y={88} s={1.12} v={2} />
        <Bush x={2760} y={88} s={0.88} v={1} />

        {/* MID HILL */}
        <path d={MID_BAND} fill="url(#hillMid)" />
        <rect x="0" y="184" width="2880" height="72" fill="url(#crestGlow)" opacity="0.45" clipPath="url(#clipMid)" />
        {/* park trees — varied silhouettes (oak / broad / pine), green tones,
            sizes, and flips so no two read alike; a rock for good measure */}
        <Tree x={430} y={228} s={1.12} variant="oak" tone={0} seed={17} />
        <Tree x={610} y={224} s={0.78} variant="pine" tone={3} seed={52} />
        <Tree x={880} y={214} s={1.04} variant="broad" tone={2} seed={88} flip />
        <Rock x={1030} y={208} s={1.1} />
        {/* a tiered pine here (was a second broad) so the two most-visible trees
            read as clearly different species, not a mirrored copy */}
        <Tree x={1980} y={206} s={1.24} variant="pine" tone={1} seed={140} />
        <Tree x={2180} y={216} s={0.82} variant="pine" tone={1} seed={203} flip />
        <Tree x={2430} y={226} s={1.0} variant="oak" tone={3} seed={266} />
        <Tree x={2620} y={230} s={1.12} variant="oak" tone={4} seed={311} flip />
        {/* MOBILE ONLY — the phone crop (x≈1223–1657) sees none of the trees
            above, which all sit in the wings. This one lands in that band so a
            tree always shows on a phone; hidden ≥640px (see .scout-scene-mobile
            in globals) so it never clutters the desktop center lockup. */}
        <g className="scout-scene-mobile">
          <Tree x={1590} y={210} s={1.12} variant="oak" tone={2} seed={175} />
        </g>

        {/* FRONT GRASS */}
        <path d={FRONT_BAND} fill="url(#hillFront)" />
        <rect x="0" y="324" width="2880" height="72" fill="url(#crestGlow)" opacity="0.35" clipPath="url(#clipFront)" />

        {/* daisy clusters — center ones survive the phone crop */}
        <Flowers x={300} y={452} seed={13} />
        <Flowers x={560} y={496} seed={47} />
        <Flowers x={870} y={452} seed={92} />
        <Flowers x={1050} y={492} seed={126} />
        <Flowers x={1360} y={436} seed={181} />
        <Flowers x={1550} y={470} seed={214} />
        <Flowers x={1840} y={448} seed={269} />
        <Flowers x={2020} y={496} seed={318} />
        <Flowers x={2400} y={452} seed={355} />
        <Flowers x={2680} y={484} seed={402} />
        {/* grass tufts */}
        <g stroke="#3fa85c" strokeWidth="4" strokeLinecap="round">
          <path d="M380 488 q3 -16 6 0 M388 488 q3 -20 6 0" />
          <path d="M970 470 q3 -16 6 0 M978 470 q3 -20 6 0 M986 470 q3 -14 6 0" />
          <path d="M1280 510 q3 -16 6 0 M1288 510 q3 -20 6 0" />
          <path d="M1450 540 q3 -16 6 0 M1458 540 q3 -20 6 0 M1466 540 q3 -14 6 0" />
          <path d="M1760 480 q3 -16 6 0 M1768 480 q3 -20 6 0" />
          <path d="M2540 498 q3 -16 6 0 M2548 498 q3 -20 6 0" />
        </g>
        {/* drifting pollen — a few pale specks over the meadow */}
        <g fill="#fffbe8" opacity="0.5">
          <circle cx="960" cy="336" r="2.2" />
          <circle cx="1258" cy="300" r="2" />
          <circle cx="1420" cy="286" r="2.4" />
          <circle cx="1610" cy="326" r="2" />
          <circle cx="1806" cy="368" r="2.2" />
          <circle cx="2064" cy="318" r="2" />
        </g>

        {/* foreground meadow edge — two layers for depth: a darker back row
            of blades peeking between the front row's tips */}
        <path d={BLADE_STRIP} fill="#3f9152" transform="translate(20 -6)" />
        <path d={BLADE_STRIP} fill="#3f9152" transform="translate(1460 -6)" />
        <path d={BLADE_STRIP} fill="url(#hillFore)" />
        <path d={BLADE_STRIP} fill="url(#hillFore)" transform="translate(1440 0)" />
      </svg>
    </div>
  );
}

/** Three bush silhouettes (v) — a wide asymmetric clump, a small round mound,
 * and a bumpy triple-lobe — so a hillside of them never looks stamped from one
 * mold. Each has a sun-side crown highlight and a soft contact shadow. */
const BUSH_SHAPES = [
  {
    dome: "M-30 6 C -31 -4 -24 -12 -14 -13 C -12 -18 -3 -20 2 -16 C 12 -18 24 -11 27 -3 C 29 1 30 4 30 6 Z",
    crown: "M4 -15 C 12 -16 20 -11 24 -4 C 19 -10 12 -13 4 -13 Z",
    shadowRx: 27,
  },
  {
    // a lumpy multi-lobe shrub (not a single smooth blob)
    dome: "M-23 6 C -24 -3 -19 -10 -12 -10 C -10 -16 -2 -16 1 -11 C 4 -16 14 -15 17 -8 C 23 -7 24 2 23 6 Z",
    crown: "M1 -13 C 8 -14 14 -11 17 -6 C 12 -12 5 -13 1 -12 Z",
    shadowRx: 23,
  },
  {
    dome: "M-32 6 C -33 -3 -28 -9 -20 -9 C -19 -16 -8 -18 -3 -13 C 2 -19 12 -18 15 -11 C 24 -13 32 -6 32 6 Z",
    crown: "M-3 -13 C 4 -15 11 -12 14 -6 C 8 -12 1 -13 -3 -11 Z",
    shadowRx: 32,
  },
] as const;

function Bush({ x, y, s, v = 0 }: { x: number; y: number; s: number; v?: number }) {
  const shape = BUSH_SHAPES[v % BUSH_SHAPES.length];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="6" rx={shape.shadowRx} ry="3.5" fill="#6ea86b" opacity="0.4" />
      <path d={shape.dome} fill="#a9d191" />
      {/* lit crown toward the sun */}
      <path d={shape.crown} fill="#c4e2ad" opacity="0.9" />
      <ellipse cx="0" cy="4.5" rx={shape.shadowRx * 0.78} ry="2.2" fill="#8fbf7d" opacity="0.5" />
    </g>
  );
}

/** Green palettes so no two trees read identically (dark under-layer, main
 * mass, sun-lit lobe, shade). Five tones spread across the row. */
const TREE_PALETTES = [
  { under: "#4c9a59", mass: "#5fb06a", lit: "#7fc785", shade: "#428a4f" }, // fresh
  { under: "#3f8b53", mass: "#579d61", lit: "#79bd7e", shade: "#3a7d4b" }, // deeper
  { under: "#6bab5a", mass: "#83c06d", lit: "#a2d68a", shade: "#5c9a4f" }, // olive/light
  { under: "#35814d", mass: "#4a9459", lit: "#6fb474", shade: "#2f6f43" }, // pine-dark
  { under: "#7bb85f", mass: "#93c974", lit: "#b3dd93", shade: "#69a552" }, // spring-bright
] as const;
const TRUNKS = ["#7a5a3b", "#6f5136", "#82623f", "#654a32", "#8a6a44"] as const;

/**
 * A park tree with real variety: `variant` picks the silhouette (round oak,
 * broad/flatter, or a tiered pine) and `tone` picks the green palette, so a
 * row of trees never looks stamped from one mold. Lighting stays sun-side even
 * when flipped.
 */
function Tree({
  x,
  y,
  s,
  flip,
  variant = "oak",
  tone = 0,
  seed = 0,
}: {
  x: number;
  y: number;
  s: number;
  flip?: boolean;
  variant?: "oak" | "broad" | "pine";
  tone?: 0 | 1 | 2 | 3 | 4;
  seed?: number;
}) {
  const p = TREE_PALETTES[tone];
  const trunk = TRUNKS[tone];
  // per-tree jitter so even same variant/tone never reads stamped: a small lean
  // + height stretch + a nudge to the sun-lit lobes.
  const lean = ((seed % 9) - 4) * 1.1; // ±~4.4°
  const yStretch = 1 + (((seed >> 3) % 7) - 3) * 0.03; // ±9% height
  const lobeDx = (((seed >> 6) % 5) - 2) * 1.4;
  const lobeDy = (((seed >> 9) % 5) - 2) * 1.2;

  if (variant === "pine") {
    return (
      <g transform={`translate(${x} ${y}) rotate(${lean}) scale(${flip ? -s : s} ${(s * yStretch).toFixed(3)})`}>
        <ellipse cx="0" cy="42" rx="20" ry="4.2" fill="#3c8a50" opacity="0.3" />
        <rect x="-3" y="26" width="6" height="16" rx="2" fill={trunk} />
        {/* three stacked tiers, dark→light bottom→top */}
        <path d="M0 -34 L 15 -6 L -15 -6 Z" fill={p.under} />
        <path d="M0 -20 L 18 12 L -18 12 Z" fill={p.mass} />
        <path d="M0 -6 L 21 30 L -21 30 Z" fill={p.under} />
        {/* sun-side highlight on each tier's right face */}
        <g transform={flip ? "scale(-1 1)" : undefined} fill={p.lit} opacity="0.55">
          <path d="M0 -34 L 15 -6 L 4 -6 Z" />
          <path d="M0 -6 L 21 30 L 6 30 Z" />
        </g>
      </g>
    );
  }

  // "broad" is markedly wider + flatter than the round "oak" — a distinct crown.
  const wide = variant === "broad";
  const sx = (flip ? -s : s) * (wide ? 1.34 : 1);
  const sy = s * (wide ? 0.78 : 1) * yStretch;
  return (
    <g transform={`translate(${x} ${y}) rotate(${lean}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`}>
      <ellipse cx="1" cy="42" rx="24" ry="4.5" fill="#3c8a50" opacity="0.32" />
      <path d="M-3.5 4 C -3 20 -4 32 -7.5 41 L 7.5 41 C 4.5 32 3.5 20 3.5 4 Z" fill={trunk} />
      <path d="M-1 14 C -6 10 -10 4 -11 -2 L -7.5 -1 C -6.5 4 -3.5 9 0 12 Z" fill={trunk} opacity="0.82" />
      <path
        d="M-27 10 C -38 7 -40 -8 -30 -14 C -31 -26 -18 -34 -6 -30 C 2 -39 20 -37 26 -26 C 37 -24 41 -9 31 -2 C 29 8 15 13 3 9 C -7 16 -21 15 -27 10 Z"
        fill={p.under}
      />
      <path
        d="M-24 6 C -33 3 -35 -9 -26 -14 C -27 -24 -15 -31 -4 -27 C 3 -35 18 -33 23 -23 C 33 -21 36 -8 27 -3 C 25 5 12 9 2 6 C -6 12 -18 11 -24 6 Z"
        fill={p.mass}
      />
      <g transform={flip ? "scale(-1 1)" : undefined}>
        <ellipse cx={12 + lobeDx} cy={-17 + lobeDy} rx="10" ry="6.5" fill={p.lit} opacity="0.85" />
        <ellipse cx={-1 + lobeDx} cy={-23 + lobeDy} rx="7" ry="4.5" fill={p.lit} opacity="0.6" />
        <ellipse cx={21 + lobeDx} cy={-8 + lobeDy} rx="6" ry="4" fill={p.lit} opacity="0.5" />
        <path d="M-21 1 C -13 8 1 9 11 5 C 3 11 -11 11 -20 5 Z" fill={p.shade} opacity="0.55" />
      </g>
    </g>
  );
}

/** A weathered gray rock, grounded by a soft shadow. */
function Rock({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="4" rx="18" ry="3" fill="#3c8a50" opacity="0.28" />
      <path d="M-16 4 C -18 -4 -10 -11 -2 -11 C 8 -11 17 -5 16 3 L 16 4 Z" fill="#a9aeb0" />
      <path d="M-16 4 C -14 -2 -7 -7 -2 -8 C 3 -8 6 -5 4 1 C 0 3 -8 4 -16 4 Z" fill="#c2c6c8" opacity="0.7" />
    </g>
  );
}

/** Bloom color pairs (petal / center) so clusters aren't all the same flower. */
const BLOOM_COLORS = [
  { petal: "#ffffff", center: "#ffcf4d" }, // white daisy
  { petal: "#ffc9d4", center: "#ff7d97" }, // pink
  { petal: "#f9d976", center: "#e8933a" }, // buttercup
  { petal: "#d7c4f0", center: "#9a76d8" }, // lavender
  { petal: "#ffd9a8", center: "#f0863c" }, // apricot
] as const;

/**
 * A wildflower cluster — seeded so every one is DIFFERENT (they were reading as
 * stamps): the bloom count (2–3), each bloom's color/size/offset, the leaf
 * side, and the whole cluster's rotation all vary with `seed`.
 */
function Flowers({ x, y, seed = 0 }: { x: number; y: number; seed?: number }) {
  const n = 2 + (seed % 2); // 2 or 3 blooms
  const rot = (seed % 9) - 4;
  const blooms = [];
  for (let i = 0; i < n; i++) {
    const c = BLOOM_COLORS[(seed >> (i * 3 + 1)) % BLOOM_COLORS.length];
    const bx = i === 0 ? 0 : ((seed >> (i * 3)) % 16) - 6;
    const by = i === 0 ? 0 : ((seed >> (i * 4)) % 12) - 1;
    const bs = 0.7 + ((seed >> (i * 5)) % 6) / 10; // 0.7–1.2
    blooms.push(<Daisy key={i} x={bx} y={by} petal={c.petal} center={c.center} s={bs} />);
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path
        d={seed % 2 ? "M-6 8 Q -11 7 -12 2 Q -7 3 -6 8 Z" : "M7 9 Q 13 8 14 3 Q 9 4 7 9 Z"}
        fill="#46a05f"
      />
      {blooms}
    </g>
  );
}

function Daisy({
  x,
  y,
  petal,
  center,
  s,
}: {
  x: number;
  y: number;
  petal: string;
  center: string;
  s: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g fill={petal}>
        <circle cx="3.2" cy="0" r="2" />
        <circle cx="0.99" cy="3.04" r="2" />
        <circle cx="-2.59" cy="1.88" r="2" />
        <circle cx="-2.59" cy="-1.88" r="2" />
        <circle cx="0.99" cy="-3.04" r="2" />
      </g>
      <circle cx="0" cy="0" r="1.7" fill={center} />
    </g>
  );
}

/** Five DISTINCT cumulus silhouettes so no two clouds read alike — a classic
 * puff, a long flat drift, a tall billow, a lopsided lean, and a small wisp.
 * Each path doubles as its own clip, so the shading hugs that specific outline.
 * Crown highlight sits sun-side per shape. */
const CLOUD_SILS = [
  {
    d: "M12 40 C 3 40 0 30 8 26 C 7 16 19 11 26 17 C 29 6 47 4 53 14 C 59 6 73 7 76 17 C 86 12 96 19 93 28 C 101 31 100 40 90 40 Z",
    crown: { cx: 63, cy: 10, rx: 18, ry: 8 },
  },
  {
    // long, low STREAK — wide and flat with small undulating bumps (stratus)
    d: "M6 40 C 0 40 -2 34 5 31 C 3 25 12 23 17 27 C 21 21 33 21 37 26 C 41 20 55 20 59 27 C 64 21 77 22 81 28 C 90 26 103 29 98 34 C 101 38 93 40 87 40 Z",
    crown: { cx: 54, cy: 24, rx: 26, ry: 4 },
  },
  {
    // TALL BILLOW — a few big round lobes stacked high (cumulus tower)
    d: "M18 40 C 6 40 2 27 13 22 C 7 7 28 1 37 14 C 42 -2 64 -1 67 16 C 80 9 92 19 85 29 C 93 31 90 40 79 40 Z",
    crown: { cx: 48, cy: 9, rx: 18, ry: 7 },
  },
  {
    // lopsided — tall on the left, trailing low to the right
    d: "M14 40 C 4 40 1 28 11 24 C 8 11 27 6 34 17 C 38 8 52 9 56 18 C 63 14 74 17 74 24 C 84 23 92 30 84 34 C 88 39 80 40 74 40 Z",
    crown: { cx: 30, cy: 12, rx: 15, ry: 8 },
  },
  {
    // small, low wisp — two soft humps
    d: "M20 40 C 11 40 8 32 15 28 C 13 20 25 17 32 22 C 38 15 54 16 58 24 C 66 22 74 28 68 33 C 72 38 64 40 58 40 Z",
    crown: { cx: 40, cy: 20, rx: 15, ry: 6 },
  },
] as const;

function Cloud({
  id,
  v = 0,
  className = "",
  style,
}: {
  id: string;
  v?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { d: SIL, crown } = CLOUD_SILS[v % CLOUD_SILS.length];
  const grad = `cloudFill-${id}`;
  const clip = `cloudClip-${id}`;
  return (
    <svg viewBox="0 0 104 44" className={className} style={style} fill="none" aria-hidden>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f9fcff" />
          <stop offset="100%" stopColor="#eef5fd" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={SIL} />
        </clipPath>
      </defs>
      <path d={SIL} fill={`url(#${grad})`} />
      <g clipPath={`url(#${clip})`}>
        {/* underside shade — a soft lens hugging the flat base */}
        <ellipse cx="51" cy="46" rx="50" ry="12" fill="#d6e6f5" opacity="0.75" />
        {/* crown highlight toward the sun (up-right) */}
        <ellipse cx={crown.cx} cy={crown.cy} rx={crown.rx} ry={crown.ry} fill="#ffffff" opacity="0.9" />
      </g>
    </svg>
  );
}
