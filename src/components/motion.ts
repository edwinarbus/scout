import type React from "react";

/**
 * Central tuning for the matcher's motion + card materiality.
 * Everything visual that should feel "hand-adjusted" lives here, and all
 * per-card variation is DETERMINISTIC from the dog's id — a card keeps the
 * same bent corner, tilt, and flight path across renders, like a real card
 * keeps its wear.
 */

export const MOTION = {
  /** concurrent flying cards (desktop / small screens) */
  maxFloaters: 11,
  maxFloatersMobile: 6,
  spawnIntervalMs: 190,
  /** seconds a card spends arcing a full loop around the prompt */
  orbitDur: [7, 11] as const,
  /** the prompt's screen position — the orbit's center of gravity (vw, vh) */
  orbitCenter: { x: 50, y: 30 } as const,
  /** elliptical orbit radii ranges (vw, vh) and 3D depth swing (px). A tall
      radiusY lets cards sweep UP and OVER the query text (front band) and dip
      behind it (back band) for a real orbit, not a shuffle. */
  orbitRadiusX: [22, 46] as const,
  orbitRadiusY: [16, 30] as const,
  orbitDepth: 220,
  /** concurrent floaters once the shortlist is forming — the swirl thins so
      the top picks own the stage */
  maxFloatersRanking: 7,
  /** gentle in-flight sway — a card carried on air, never a spin */
  swayDur: [2.6, 4.2] as const,
  swayDeg: 9,
  /** static 3D pose ranges (deg) — flight is angled hard so swirl cards read as
      3D objects turned on their sides, never flat; the grid stays calm */
  flightPose: { x: 18, y: 28, z: 14 },
  gridPose: { x: 2.5, y: 3.5, z: 1.6 },
  /** shortlist dealing rhythm */
  layCount: 8,
  layFirstMs: 500,
  layIntervalMs: 1000,
  /** Used-card wear is OFF — the bent-corner gradients read as translucent
      artifacts on the card corners (not charming), so cards stay clean. */
  wear: { bentCorner: 0, crease: 0, scuff: 0 },
} as const;

/** The dog's shared view-transition name — one physical card across swirl,
 * shortlist fan, and grid; the browser morphs whichever element carries it. */
export const vtName = (id: string) => `dog-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** Deterministic per-dog seed. */
export function cardSeed(id: string): number {
  let h = 7;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const pick = (seed: number, shift: number, span: number) =>
  (((seed >> shift) % 1000) / 1000) * span * 2 - span; // → [-span, +span]

/** A card's resting 3D pose. Grid is subtle; flight is angled hard AND kept off
 * zero, so every swirling card reads as a 3D object turned on its side. */
export function poseOf(id: string, kind: "flight" | "grid"): React.CSSProperties {
  const s = cardSeed(id);
  const r = kind === "flight" ? MOTION.flightPose : MOTION.gridPose;
  let poseY = pick(s, 7, r.y);
  if (kind === "flight") poseY = (poseY >= 0 ? 1 : -1) * Math.max(10, Math.abs(poseY)); // never flat
  return {
    "--poseX": `${pick(s, 2, r.x).toFixed(2)}deg`,
    "--poseY": `${poseY.toFixed(2)}deg`,
    "--tilt": `${pick(s, 12, r.z).toFixed(2)}deg`,
  } as React.CSSProperties;
}

export interface CardWear {
  /** which corner is softly bent, if any */
  bent: "tl" | "tr" | "bl" | "br" | null;
  /** a faint white stress crease near an edge */
  crease: boolean;
  creaseAngle: number;
  creaseX: number; // % across the card
  /** faint sleeve scuffs */
  scuff: boolean;
  scuffX: number;
  scuffY: number;
}

/** The card's permanent imperfections — same dog, same wear, every render. */
export function wearOf(id: string): CardWear {
  const s = cardSeed(id);
  const corners = ["tl", "tr", "bl", "br"] as const;
  return {
    bent: (s % 100) / 100 < MOTION.wear.bentCorner ? corners[(s >> 4) % 4] : null,
    crease: ((s >> 6) % 100) / 100 < MOTION.wear.crease,
    creaseAngle: ((s >> 9) % 70) - 35,
    creaseX: 12 + ((s >> 11) % 70),
    scuff: ((s >> 13) % 100) / 100 < MOTION.wear.scuff,
    scuffX: 10 + ((s >> 15) % 75),
    scuffY: 8 + ((s >> 17) % 70),
  };
}
