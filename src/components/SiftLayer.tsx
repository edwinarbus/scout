"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DogView } from "@/lib/dogView";
import CardFace from "./CardFace";
import { MOTION, cardSeed, poseOf, vtName } from "./motion";

/**
 * The sift — the matcher's loading animation. The prompt text is the gravity
 * source; trading cards of REAL CANDIDATES (the swirl only starts once the
 * screen has picked them) are pulled through the field around it on loose,
 * varied arcs. Each dog keeps a stable path family and 3D pose (seeded from
 * its id), cards never spin or show a back, and every exit recycles into a
 * fresh dog from the candidate pool.
 *
 * The swirl and the shortlist are ONE system: `priority` dogs (the upcoming
 * top picks) board the orbit first, and when the deal plucks one, the parent
 * arms it (`armedId`) so its in-flight floater carries the dog's shared
 * view-transition name — the browser then morphs that exact card out of the
 * swirl into its fan slot. Floaters are the same width as the fan cards so
 * the hand-off reads as one physical card changing hands.
 */

type Band = "back" | "mid" | "front";

interface Floater {
  key: number;
  dog: DogView;
  band: Band;
  dur: number;
  sway: number;
  vars: React.CSSProperties;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * A true elliptical ORBIT around the prompt (the gravity center). Each card
 * arcs 210–330° around the center over six waypoints. Scale + parallax depth
 * vary along the arc so it reads 3D, but the STACKING ORDER is fixed for the
 * whole flight — each card commits to a depth band (behind the prompt, or in
 * front) with a unique z-index inside that band. That's the anti-flash fix:
 * a z-index that flipped mid-arc popped cards over each other, and equal
 * z-indexes z-fought. Direction/radii/start are seeded per dog (stable).
 */
function orbitVars(dogId: string): { vars: React.CSSProperties; band: Band } {
  const s = cardSeed(dogId);
  const dir = s & 1 ? 1 : -1;
  const [rxLo, rxHi] = MOTION.orbitRadiusX;
  const [ryLo, ryHi] = MOTION.orbitRadiusY;
  const rx = rxLo + ((s >> 1) % 100) / 100 * (rxHi - rxLo) + rand(-2, 2);
  const ry = ryLo + ((s >> 4) % 100) / 100 * (ryHi - ryLo) + rand(-2, 2);
  const start = ((s >> 7) % 360) + rand(-20, 20);
  const sweep = dir * (210 + ((s >> 9) % 120) + rand(-15, 15));
  const { x: cx, y: cy } = MOTION.orbitCenter;
  const D = MOTION.orbitDepth;

  // Commit to one depth band for the whole flight. avg interior depth < 0 rides
  // the bottom of the ellipse (toward the viewer) → FRONT; > 0 rides the top
  // (away) → BACK; the shallow middle threads BETWEEN the two query lines → MID.
  const interior = [0.16, 0.4, 0.62, 0.84].map((t) =>
    Math.sin(((start + sweep * t) * Math.PI) / 180)
  );
  const avg = interior.reduce((a, b) => a + b, 0) / interior.length;
  // widened so more of the swirl commits to MID — threading between the query's
  // two lines is the most interesting depth read, not just a rare middle case
  const band: Band = avg < -0.45 ? "front" : avg > 0.45 ? "back" : "mid";
  // unique-ish z within the band → stable, non-fighting stacking. Each stage is
  // its own layer (back z-6, mid z-20, front z-26); --zi orders within it.
  const ziBase = band === "front" ? 12 : band === "mid" ? 7 : 2;
  const zi = ziBase + ((s >> 3) % 5);

  const vars: Record<string, string> = { "--zi": `${zi}` };
  const ts = [0, 0.16, 0.4, 0.62, 0.84, 1];
  ts.forEach((t, i) => {
    const a = ((start + sweep * t) * Math.PI) / 180;
    const ext = i === 0 || i === ts.length - 1 ? 1.5 : 1; // fling in/out from outside
    const x = cx + Math.cos(a) * rx * ext;
    const y = cy - Math.sin(a) * ry * ext;
    const depth = Math.sin(a); // +1 top of ellipse, -1 bottom
    vars[`--x${i}`] = `${x.toFixed(1)}vw`;
    vars[`--y${i}`] = `${y.toFixed(1)}vh`;
    vars[`--z${i}`] = `${Math.round(-depth * D)}px`; // parallax push/pull
    // real depth: cards near the viewer (front band, bottom of the arc) grow;
    // far cards shrink. A wide range sells the 3D scene.
    vars[`--sc${i}`] = (0.82 + ((1 - depth) / 2) * 0.5).toFixed(2);
    vars[`--rot${i}`] = `${(Math.cos(a) * 8).toFixed(1)}deg`; // lean into the arc
  });
  return { vars: vars as React.CSSProperties, band };
}

export default function SiftLayer({
  pool,
  active,
  excludeIds,
  priority,
  armedId,
}: {
  pool: DogView[];
  active: boolean;
  /**
   * Dogs already plucked into the shortlist row — kept OUT of the swirl so the
   * same dog never appears twice on screen (orbiting AND in the row). Applied
   * at RENDER time (not just in an effect) so a pluck's view transition never
   * snapshots the floater and the fan card together.
   */
  excludeIds?: Set<string>;
  /** Upcoming top picks — these board the orbit before anyone else, so the
   *  cards that will be plucked are visibly part of the sift first. */
  priority?: string[];
  /** The dog about to be plucked: its floater carries the shared
   *  view-transition name so the morph connects swirl → fan slot. */
  armedId?: string | null;
}) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const keyRef = useRef(0);
  const idxRef = useRef(0);
  const poolRef = useRef(pool);
  poolRef.current = pool;
  const excludeRef = useRef(excludeIds);
  excludeRef.current = excludeIds;
  const priorityRef = useRef(priority);
  priorityRef.current = priority;
  const inUse = useRef(new Set<string>());
  // Mirror of floaters for guards outside setState (keeps updaters pure —
  // React StrictMode double-invokes updater functions in dev, so ref
  // mutations inside them would leak inUse ids until the swirl starves).
  const floatersRef = useRef<Floater[]>([]);
  floatersRef.current = floaters;
  // Thin the swirl once the shortlist is forming (excludeIds present) — the
  // top picks own the stage; the search just hums along behind them.
  const maxFloaters = Math.min(
    typeof window !== "undefined" && window.innerWidth < 768
      ? MOTION.maxFloatersMobile
      : MOTION.maxFloaters,
    excludeIds?.size ? MOTION.maxFloatersRanking : Infinity
  );

  const makeFloater = useCallback((): Floater | null => {
    const p = poolRef.current;
    if (!p.length) return null;
    const spawn = (dog: DogView): Floater => {
      inUse.current.add(dog.id);
      const { vars, band } = orbitVars(dog.id);
      return {
        key: keyRef.current++,
        dog,
        band,
        dur: rand(MOTION.orbitDur[0], MOTION.orbitDur[1]),
        sway: rand(MOTION.swayDur[0], MOTION.swayDur[1]),
        vars,
      };
    };
    // The upcoming top picks board first — the very cards that will be plucked
    // into the shortlist are orbiting before anyone else.
    for (const id of priorityRef.current ?? []) {
      if (inUse.current.has(id) || excludeRef.current?.has(id)) continue;
      const dog = p.find((d) => d.id === id);
      if (dog?.primaryPhotoUrl) return spawn(dog);
    }
    // …then the rest of the pool, round-robin.
    for (let tries = 0; tries < Math.min(p.length, 60); tries++) {
      const dog = p[idxRef.current++ % p.length];
      if (!dog.primaryPhotoUrl || inUse.current.has(dog.id) || excludeRef.current?.has(dog.id))
        continue;
      return spawn(dog);
    }
    return null;
  }, []);

  // Ramp up to the floater cap while active; clear everything when not.
  useEffect(() => {
    if (!active) {
      inUse.current.clear();
      setFloaters([]);
      return;
    }
    const iv = setInterval(() => {
      if (floatersRef.current.length >= maxFloaters) return;
      const f = makeFloater();
      if (f) setFloaters((fs) => [...fs, f]);
    }, MOTION.spawnIntervalMs);
    return () => clearInterval(iv);
  }, [active, makeFloater, maxFloaters]);

  // Drop in-flight floaters whose dog just got reserved for the table.
  useEffect(() => {
    if (!excludeIds?.size) return;
    const doomed = floatersRef.current.filter((f) => excludeIds.has(f.dog.id));
    if (!doomed.length) return;
    for (const f of doomed) inUse.current.delete(f.dog.id);
    setFloaters((fs) => fs.filter((f) => !excludeIds.has(f.dog.id)));
  }, [excludeIds]);

  const recycle = useCallback(
    (key: number, dogId: string) => {
      inUse.current.delete(dogId);
      // Only respawn if we're under the (possibly thinned) cap — this is how
      // the swirl actually shrinks when the shortlist phase lowers the cap.
      const f = floatersRef.current.length <= maxFloaters ? makeFloater() : null;
      setFloaters((fs) => {
        const rest = fs.filter((x) => x.key !== key);
        return f ? [...rest, f] : rest;
      });
    },
    [makeFloater, maxFloaters]
  );

  if (!active) return null;

  // excluded (just-plucked) floaters are dropped IN RENDER so the pluck's view
  // transition never sees the dog twice. Split by depth band into two layers:
  // the BACK layer sits behind the query text, the FRONT layer sweeps OVER it —
  // that's the real orbit + depth (see .scout-sift-back / -front z-index).
  const visible = floaters.filter((f) => !excludeIds?.has(f.dog.id));
  const renderFloater = (f: Floater) => (
    <div
      key={f.key}
      className="scout-sift"
      style={{ ...f.vars, "--dur": `${f.dur}s` } as React.CSSProperties}
      onAnimationEnd={(e) => {
        if (e.animationName === "scout-orbit") recycle(f.key, f.dog.id);
      }}
    >
      <div
        className="scout-sift-sway"
        style={
          {
            "--sway": `${f.sway}s`,
            filter: "drop-shadow(0 22px 26px rgba(41,32,26,0.3))",
          } as React.CSSProperties
        }
      >
        <div className="scout-pose-flight" style={poseOf(f.dog.id, "flight")}>
          {/* same width as a fan slot — the pluck reads as ONE card. The
              data-sift-card handle lets the deal measure this floater's live
              orbit position the instant before it's plucked, so the fan card
              can FLIP in from exactly here (see flipPluck in ScoutApp). */}
          <div
            data-sift-card={f.dog.id}
            className="aspect-[5/7] w-[104px] sm:w-[clamp(96px,11vw,136px)]"
            style={
              f.dog.id === armedId
                ? ({ viewTransitionName: vtName(f.dog.id) } as React.CSSProperties)
                : undefined
            }
          >
            <CardFace dog={f.dog} showStats={false} />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="scout-sift-stage scout-sift-back absolute inset-0 overflow-hidden">
        {visible.filter((f) => f.band === "back").map(renderFloater)}
      </div>
      <div className="scout-sift-stage scout-sift-mid absolute inset-0 overflow-hidden">
        {visible.filter((f) => f.band === "mid").map(renderFloater)}
      </div>
      <div className="scout-sift-stage scout-sift-front absolute inset-0 overflow-hidden">
        {visible.filter((f) => f.band === "front").map(renderFloater)}
      </div>
    </>
  );
}
