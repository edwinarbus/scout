"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { DogView } from "@/lib/dogView";
import type { UserDogStatus } from "@/lib/types";
import type { ParsedQuery } from "@/lib/aiSearch";
import { screeningLines, screeningLinesForText } from "@/lib/screening";
import DogCard from "./DogCard";
import FilterBar, { DEFAULT_FILTERS, type Filters } from "./FilterBar";
import MicButton from "./MicButton";
import CardExpanded from "./CardExpanded";
import { cardSeed, vtName } from "./motion";
import CardFace from "./CardFace";
import SiftLayer from "./SiftLayer";
import Typewriter from "./Typewriter";
import ScoutMascot from "./ScoutMascot";
import DogParkScene from "./DogParkScene";
import WatchesPanel from "./WatchesPanel";
import SavedPanel from "./SavedPanel";
import { DogPhoto, PHOTO_BROKEN_EVENT, fmtAge, statusGroup } from "./ui";
import { isPlaceholderPhotoUrl } from "@/lib/photo";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-ink-300">Loading map…</div>
  ),
});

const EXAMPLE_QUERIES = [
  "small calm dog under 25 lb, good with cats",
  "scruffy senior terrier near Oakland",
  "mellow older lap dog for an apartment",
  "medium fluffy dog, house-trained, good with kids",
  "low-energy senior who's waited a long time",
  "hypoallergenic poodle mix under 30 lb",
  "gentle giant that's already leash-trained",
  "playful young pup for weekend hikes near LA",
  "black lab mix, good with other dogs",
  "chihuahua who wants to be a lap warmer",
  "quiet couch companion, no puppies",
  "long-haired dog that loves belly rubs",
];

/** The example chips fan across the width; used to fade/rotate them in. */

/** Minimal paw glyph (no emoji) — used only in the small empty state. */
function PawMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <ellipse cx="12" cy="15.5" rx="4.6" ry="3.7" />
      <ellipse cx="5.6" cy="10.2" rx="1.9" ry="2.5" />
      <ellipse cx="10" cy="6.6" rx="2" ry="2.7" />
      <ellipse cx="14" cy="6.6" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="10.2" rx="1.9" ry="2.5" />
    </svg>
  );
}

/** How many screened candidates feed the sift once they're known. */
const SIFT_POOL_SIZE = 24;
/** How many candidates get drawn from the swirl and laid on the table. */
const LAY_COUNT = 8;
/** Shortlist deal choreography. Each pluck is its own view transition — the
 *  orbiting card morphs into its fan slot — so the pace is OUR clock (one
 *  pluck per PLUCK_MS), not a CSS stagger. */
const PLUCK_MS = 820;
/** After the screen lands, hold on the swirl long enough for the top picks to
 *  visibly board the orbit before we start pulling them out ("wait for the
 *  right cards" — priority spawns ≈ 8 × 200ms + entry flight). */
const FOCUS_MS = 2100;
/** View Transitions support — without it the fan falls back to the scout-lay
 *  swoop-in (the ranking view never server-renders, so this is hydration-safe).
 *  Deliberately OFF below the mobile breakpoint too: WebKit's implementation
 *  is unreliable on a page this transform-heavy (mascot, tilted cards) — it can
 *  leave a frozen, dimmed snapshot of the old page on screen instead of
 *  completing the morph. A plain instant state swap never has that failure
 *  mode, and mobile doesn't miss the cross-fade the way a desktop layout would. */
const HAS_VT =
  typeof document !== "undefined" &&
  "startViewTransition" in document &&
  typeof window !== "undefined" &&
  window.innerWidth >= 768;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Phases of a staged match — each maps to a visible moment on the page. */
type Phase = "idle" | "parsing" | "screening" | "ranking" | "done";

interface AiResult {
  dog: DogView;
  score: number;
  reasons: string[];
  unknowns: string[];
}
interface AiSearchState {
  query: string;
  interpretation: string;
  usedLocation: boolean;
  reranked: boolean;
  totalDogs: number;
  shortlistSize: number;
  results: AiResult[];
}

/** Re-sort/land with the View Transitions API when available (smooth morph).
 * Starting a new transition auto-skips one already in flight, which rejects
 * the skipped transition's promises with InvalidStateError — expected here
 * (fast searches, Clear mid-morph), so those rejections are swallowed. */
function withViewTransition(update: () => void) {
  const d = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  if (HAS_VT && d.startViewTransition) {
    const vt = d.startViewTransition(() => flushSync(update));
    vt.ready.catch(() => {});
    vt.finished.catch(() => {});
  } else {
    update();
  }
}

const cssEsc = (v: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");

/**
 * Pluck a card out of the swirl into its fan slot — WITHOUT a view transition.
 *
 * A full-page `startViewTransition` composites a frozen snapshot of the entire
 * page (the whole orbit included) on top of the live DOM for the transition's
 * ENTIRE lifetime — not just root's own group animation — so every pluck froze
 * the swirl for the ~0.8s the card took to land, read as the orbit stuttering.
 * Instead we FLIP only the ONE new card: measure the orbiting floater's live
 * screen rect the instant before it leaves, commit the state (floater gone, fan
 * card mounted), then animate JUST that fan card from the orbit position into
 * its slot. Nothing else is snapshotted, so the rest of the swirl keeps spinning
 * perfectly smoothly underneath. Falls back to a soft rise if the floater isn't
 * on screen (rare) and to an instant commit under reduced motion.
 */
function flipPluck(id: string | null, commit: () => void) {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const from =
    id && !reduce && typeof document !== "undefined"
      ? document.querySelector(`[data-sift-card="${cssEsc(id)}"]`)?.getBoundingClientRect()
      : null;
  flushSync(commit); // fan card now mounted; the orbiting floater is gone
  if (!id || reduce) return;
  const slot = document.querySelector<HTMLElement>(`[data-fan-card="${cssEsc(id)}"]`);
  if (!slot) return;
  const to = slot.getBoundingClientRect();
  if (to.width === 0) return;
  const ease = "cubic-bezier(0.32, 0.72, 0.15, 1)";
  if (from && from.width > 0) {
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sc = from.width / to.width;
    slot.animate(
      [
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sc.toFixed(3)})` },
        { transform: "translate(0px, 0px) scale(1)" },
      ],
      { duration: 620, easing: ease, fill: "both" }
    );
  } else {
    // no live floater to fly from — a soft rise so it's never a hard pop
    slot.animate(
      [
        { opacity: 0, transform: "translateY(-22px) scale(0.9)" },
        { opacity: 1, transform: "translateY(0px) scale(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(0.22, 0.7, 0.24, 1)", fill: "both" }
    );
  }
}

/** Split the reading into EXACTLY two lines so the sift can weave BETWEEN them
 * (cards pass under the first line, over the second). The split is balanced by
 * CHARACTER length — not word count — so neither half is overloaded and wraps
 * to a third line; each half is then rendered nowrap so it stays one line.
 * Short queries stay a single line — nothing to weave through. */
function splitQueryLines(text: string): [string, string] {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4) return [t, ""];
  const half = t.length / 2;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const firstLen = words.slice(0, i).join(" ").length;
    const diff = Math.abs(firstLen - half);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/** Per-card rest tilt + a gentle opposite hover tip. The tilt's SIGN alternates
 * by grid slot — not by seed — so neighboring cards always lean opposite ways
 * and a row can NEVER read as all pointing the same direction; the magnitude
 * stays seeded so the scatter still feels organic rather than mechanical. */
function tiltStyle(id: string, i = 0): React.CSSProperties {
  const s = cardSeed(id);
  const sign = i % 2 === 0 ? -1 : 1;
  const deg = sign * (0.9 + ((s % 1000) / 1000) * 1.6); // 0.9–2.5°, alternating lean
  const hover = -sign * (1.8 + ((s >> 5) % 10) / 10); // opposite, gentle 1.8–2.7°
  return { "--tilt": `${deg.toFixed(2)}deg`, "--tilt-hover": `${hover.toFixed(2)}deg` } as React.CSSProperties;
}

/** Fired when a watch has been "collected" by the header bell — the bell
 * briefly turns into a checkmark (WatchesPanel listens). */
export const WATCH_COLLECTED_EVENT = "scout:watch-collected";

/**
 * The "collect" feedback for saving a watch: THE bell icon on the Watch button
 * — same spot, same size — lifts up out of the green button, grows a touch and
 * turns from white to the header's gray as it glides, then lands EXACTLY on the
 * header bell (same position, same size) and merges into it; the header bell
 * then flips to a checkmark. Pure DOM + WAAPI (the flyer lives outside React),
 * removed on finish; reduced-motion skips straight to the checkmark flip.
 */
function flyBellToHeader(fromEl: HTMLElement | null) {
  if (typeof document === "undefined") return;
  const done = () => window.dispatchEvent(new Event(WATCH_COLLECTED_EVENT));
  const target = document.querySelector('[aria-label="Notifications and watches"]');
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!fromEl || !target || reduced) return done();
  // fly the ICONS' geometry, not the buttons': start = the little white bell on
  // the green button, end = the header bell glyph — exact rect to exact rect.
  const fromSvg = fromEl.querySelector("svg");
  const toSvg = target.querySelector("svg");
  const from = (fromSvg ?? fromEl).getBoundingClientRect();
  const to = (toSvg ?? target).getBoundingClientRect();
  if (!from.width || !to.width) return done();
  const endColor = toSvg ? getComputedStyle(toSvg).color : "#5c6f66";
  const el = document.createElement("span");
  el.className = "scout-fly-bell";
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${from.width}" height="${from.height}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  el.style.left = `${from.left}px`;
  el.style.top = `${from.top}px`;
  el.style.color = "#3a444c"; // dark gray from the very first frame — visible on the light bg (never white)
  el.style.transformOrigin = "50% 50%";
  document.body.appendChild(el);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const endScale = to.width / from.width; // land at the header bell's exact size
  let fired = false;
  const finish = () => {
    if (fired) return;
    fired = true;
    el.remove();
    done();
  };
  // A SMOOTH curved arc: sample a quadratic Bézier (control point bowed up and
  // over toward the bell) at many points, with the position eased-out so it
  // flies fast then settles into the bell. Many samples = a true curve, not the
  // angular two-segment bend the old keyframes made; linear timing over eased
  // positions = no pause anywhere. Dark gray → the header bell's gray en route.
  const ctrlX = dx * 0.6;
  const ctrlY = dy - 70;
  const N = 14;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const lin = i / N;
    const t = 1 - Math.pow(1 - lin, 2.4); // ease-out: quick lift-off, gentle landing
    const mt = 1 - t;
    const x = 2 * mt * t * ctrlX + t * t * dx;
    const y = 2 * mt * t * ctrlY + t * t * dy;
    const scale = 1.5 + (endScale - 1.5) * t;
    const f: Keyframe = {
      offset: lin,
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`,
    };
    if (i === 0) f.color = "#3a444c";
    if (i === N) f.color = endColor;
    frames.push(f);
  }
  el.animate(frames, { duration: 560, easing: "linear", fill: "forwards" }).addEventListener(
    "finish",
    finish,
    { once: true }
  );
  window.setTimeout(finish, 800); // safety net
}

/** Only surface dogs someone could actually adopt: available (incl. foster) and
 * not gone missing/stale from recent checks. Non-available listings are hidden. */
function isAdoptable(d: DogView): boolean {
  return (
    statusGroup(d.statusNormalized) === "available" &&
    d.freshness !== "missing" &&
    d.freshness !== "stale"
  );
}

export default function ScoutApp() {
  const [dogs, setDogs] = useState<DogView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  /** Photo URLs that failed to load or resolved to a placeholder graphic — the
   *  dogs behind them are dropped from every list (reported by DogPhoto). */
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Card currently lifted off the table into its full profile. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The clicked card's on-screen rect, so the profile grows + turns from it. */
  const [expandedRect, setExpandedRect] = useState<DOMRect | null>(null);
  /** True when opened from a map/list listing — plain fade-in dossier, no flip. */
  const [expandPlain, setExpandPlain] = useState(false);

  const [view, setView] = useState<"match" | "browse">("match");
  const [resultsAsMap, setResultsAsMap] = useState(false);

  // Staged matcher state.
  const [askInput, setAskInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [ai, setAi] = useState<AiSearchState | null>(null);
  const [watchSaved, setWatchSaved] = useState(false); // "Watch this search" feedback
  const [typedHint, setTypedHint] = useState(""); // typewriter placeholder
  /** Rotating window into EXAMPLE_QUERIES — four shown at a time, cycling. */
  const [chipStart, setChipStart] = useState(0);
  /** How many top picks have been plucked out of the swirl so far. */
  const [laidCount, setLaidCount] = useState(0);
  /** The dog about to be plucked — its floater carries the vt name. */
  const [armedId, setArmedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchSeq = useRef(0); // invalidates in-flight stages when a new search starts

  const busy = phase === "parsing" || phase === "screening" || phase === "ranking";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dogs");
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as { dogs: DogView[] };
      setDogs(data.dogs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Cycle the four visible example chips while the landing is idle + untouched.
  useEffect(() => {
    if (phase !== "idle" || askInput) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return; // no rotation for reduced-motion — the first four stay
    const t = setInterval(() => setChipStart((s) => (s + 4) % EXAMPLE_QUERIES.length), 4600);
    return () => clearInterval(t);
  }, [phase, askInput]);

  // Typewriter placeholder: type an example, hold, erase, next — but only while
  // the box is empty and idle, so it never fights what the user is typing.
  useEffect(() => {
    if (phase !== "idle" || askInput) {
      setTypedHint("");
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Shuffle the phrases so the box's typed prompt is NOT in lock-step with
    // the suggestion pills (which show them in source order) — the two feeds
    // read as independent (Fisher–Yates; client-only effect, so random is fine).
    const order = [...EXAMPLE_QUERIES];
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    let timer: ReturnType<typeof setTimeout>;
    let li = 0;
    let ci = 0;
    let mode: "type" | "hold" | "erase" = "type";
    const tick = () => {
      const line = order[li % order.length];
      if (reduced) {
        setTypedHint(line);
        li++;
        timer = setTimeout(tick, 2600);
        return;
      }
      if (mode === "type") {
        ci++;
        setTypedHint(line.slice(0, ci));
        if (ci >= line.length) {
          mode = "hold";
          timer = setTimeout(tick, 1800);
        } else timer = setTimeout(tick, 42 + Math.random() * 46);
      } else if (mode === "hold") {
        mode = "erase";
        timer = setTimeout(tick, 160);
      } else {
        ci -= 2;
        if (ci <= 0) {
          ci = 0;
          setTypedHint(""); // fully clear — was leaving the first char trailing
          li++;
          mode = "type";
          timer = setTimeout(tick, 320);
        } else {
          setTypedHint(line.slice(0, ci));
          timer = setTimeout(tick, 18);
        }
      }
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [phase, askInput]);

  // Drop a dog the moment its photo proves broken/placeholder anywhere on screen.
  useEffect(() => {
    const onBroken = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      if (!url) return;
      setBrokenUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
    };
    window.addEventListener(PHOTO_BROKEN_EVENT, onBroken);
    return () => window.removeEventListener(PHOTO_BROKEN_EVENT, onBroken);
  }, []);

  // If the currently-shown search's watch is deleted from the bell panel,
  // re-arm its "Watch this search" button so it can be watched again.
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (q && q.trim() === activeQuery.trim()) setWatchSaved(false);
    };
    window.addEventListener("scout:watch-deleted", onDeleted);
    return () => window.removeEventListener("scout:watch-deleted", onDeleted);
  }, [activeQuery]);

  /** A dog worth showing: adoptable AND backed by a real, loadable photo. */
  const displayable = useCallback(
    (d: DogView): boolean =>
      isAdoptable(d) &&
      !!d.primaryPhotoUrl &&
      !isPlaceholderPhotoUrl(d.primaryPhotoUrl) &&
      !brokenUrls.has(d.primaryPhotoUrl),
    [brokenUrls]
  );

  const filtered = useMemo(() => {
    if (!dogs) return [];
    const q = filters.q.trim().toLowerCase();
    return dogs.filter((d) => {
      if (!displayable(d)) return false;
      if (!filters.showHidden && (d.userStatus === "hidden" || d.userStatus === "not_a_fit" || d.userStatus === "adopted_elsewhere"))
        return false;
      if (!filters.showStale && (d.freshness === "missing" || d.freshness === "uncertain"))
        return false;
      if (filters.sourceId !== "all" && d.source.id !== filters.sourceId) return false;
      if (filters.statuses.length && !filters.statuses.includes(statusGroup(d.statusNormalized)))
        return false;
      if (filters.sizes.length && (!d.sizeNormalized || !filters.sizes.includes(d.sizeNormalized)))
        return false;
      if (filters.ageBuckets.length && (!d.ageBucket || !filters.ageBuckets.includes(d.ageBucket)))
        return false;
      if (filters.onlyMatches && d.matchedSearches.length === 0) return false;
      if (
        filters.onlyMine &&
        !(d.userStatus === "saved" || d.userStatus === "maybe" || d.userStatus === "contacted")
      )
        return false;
      if (q) {
        const hay = [d.name, d.breedRaw, d.breedNormalized, d.biographyRaw, d.city, d.shelterName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [dogs, filters, displayable]);

  const resultById = useMemo(() => {
    const m = new Map<string, AiResult>();
    if (ai) for (const r of ai.results) m.set(r.dog.id, r);
    return m;
  }, [ai]);

  // The top picks the deal will pluck, in screened order — known the moment
  // the screen lands (so they can board the orbit as priority spawns) and the
  // exact list the pluck loop walks.
  const shortlistDogs = useMemo(
    () =>
      ai
        ? ai.results
            .map((r) => r.dog)
            .filter(displayable)
            .slice(0, LAY_COUNT)
        : [],
    [ai, displayable]
  );
  const shortlistRef = useRef<DogView[]>([]);
  shortlistRef.current = shortlistDogs;

  /** Top picks plucked so far — the fan renders these; the swirl excludes them. */
  const laidDogs = useMemo(() => shortlistDogs.slice(0, laidCount), [shortlistDogs, laidCount]);
  const reservedIds = useMemo(() => new Set(laidDogs.map((d) => d.id)), [laidDogs]);

  /**
   * The sift's candidate pool — REAL candidates only. The swirl doesn't start
   * until the screen has picked them (worth the short wait: every card in the
   * sift is a dog that actually fits, and the top picks among them get plucked
   * into the shortlist row).
   */
  const siftPool = useMemo(() => {
    if (!ai) return [];
    return ai.results
      .map((r) => r.dog)
      .filter(displayable)
      .slice(0, LAY_COUNT + SIFT_POOL_SIZE);
  }, [ai, displayable]);

  const gridDogs =
    view === "match" && ai ? ai.results.map((r) => r.dog).filter(displayable) : [];
  const browseDogs = filtered;

  const expandedDog = useMemo(
    () =>
      expandedId
        ? (dogs?.find((d) => d.id === expandedId) ??
          ai?.results.find((r) => r.dog.id === expandedId)?.dog ??
          null)
        : null,
    [expandedId, dogs, ai]
  );

  /** Open the full profile. A grid card grows + turns over from its exact slot
   *  (flip). A map/list "listing" has no trading card to flip, so it opens as a
   *  PLAIN info card that simply fades in — same dossier, no flip. */
  const openExpanded = useCallback((id: string, plain = false) => {
    if (typeof document !== "undefined" && !plain) {
      const el = document.getElementById(`card-${id}`);
      setExpandedRect(el ? el.getBoundingClientRect() : null);
    } else {
      setExpandedRect(null);
    }
    setExpandPlain(plain);
    setExpandedId(id);
  }, []);

  const openDog = useCallback(
    (id: string) => {
      setSelectedId(id);
      openExpanded(id, true); // from the map / list → plain fade-in info card
    },
    [openExpanded]
  );

  /** The staged search: parse → screen (feeds the orbit) → deep read (lands the grid). */
  const runAskSearch = useCallback(
    async (queryArg?: string) => {
      const query = (queryArg ?? askInput).trim();
      if (!query || busy) return;
      const seq = ++searchSeq.current;
      // Smooth hand-off: the hero recedes and the typed query flies up + grows
      // into the big "reading" headline (shared scout-query view-transition).
      withViewTransition(() => {
        setAskError(null);
        setAi(null);
        setParsed(null);
        setResultsAsMap(false);
        setActiveQuery(query);
        setLaidCount(0);
        setArmedId(null);
        setWatchSaved(false); // a fresh search re-arms "Watch this search"
        setPhase("parsing");
      });
      const location = null;
      const post = async (path: string, body: unknown) => {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
        return data;
      };
      try {
        // 1 — understand the request
        const p = (await post("/api/search/parse", { query })) as { parsed: ParsedQuery };
        if (seq !== searchSeq.current) return;
        setParsed(p.parsed);
        setPhase("screening");

        // 2 — deterministic screen: candidates exist now, but they only FEED
        // the shuffle animation — no half-ranked grid is shown.
        const f = await post("/api/search", { query, parsed: p.parsed, location, mode: "filter" });
        if (seq !== searchSeq.current) return;
        const filterState: AiSearchState = {
          query,
          interpretation: f.interpretation,
          usedLocation: !!f.usedLocation,
          reranked: false,
          totalDogs: f.totalDogs ?? 0,
          shortlistSize: f.shortlistSize ?? 0,
          results: f.results as AiResult[],
        };
        setAi(filterState);
        if (filterState.results.length === 0) {
          setPhase("done");
          return;
        }

        // 3 — kick off the deep read NOW so it runs during the focus + deal;
        // we choreograph the animation on our own clock and only take its
        // result once the deal has finished (so the sequence never gets cut).
        const fullPromise = post("/api/search", { query, parsed: p.parsed, location, mode: "full" })
          .then((r) => ({ ok: true as const, r }))
          .catch(() => ({ ok: false as const }));

        // Focus: hold on the swirl so the top picks are visibly ORBITING
        // before we start pulling them out ("wait for the right cards").
        await sleep(FOCUS_MS);
        if (seq !== searchSeq.current) return;

        // Deal: pluck each top pick out of the swirl, one at a time. Arming a
        // card first hands its in-flight floater the shared view-transition
        // name, so the browser morphs THAT card from wherever it is in its
        // orbit down into its fan slot — the swirl and the shortlist are one
        // continuous system, not two animations.
        setPhase("ranking");
        const picks = shortlistRef.current;
        for (let i = 0; i < picks.length; i++) {
          if (seq !== searchSeq.current) return;
          const pickId = picks[i]?.id ?? null;
          setArmedId(pickId);
          await sleep(60); // let the armed floater settle before we measure it
          if (seq !== searchSeq.current) return;
          // FLIP just this one card out of the orbit into its fan slot — no
          // full-page view transition, so the rest of the swirl never freezes.
          flipPluck(pickId, () => setLaidCount(i + 1));
          await sleep(PLUCK_MS);
        }
        if (seq !== searchSeq.current) return;

        const full = await fullPromise;
        if (seq !== searchSeq.current) return;

        // let the finished hand rest a beat before the grid takes over
        await sleep(700);
        if (seq !== searchSeq.current) return;

        // 4 — hand the shortlist off into the scored grid. The fan's picks stay
        // EXACTLY as plucked — the deep read's corrected order/scores land in
        // the SAME batch as the phase flip, so there's no separate moment where
        // the fan visibly re-sorts or swaps identities before the hand-off (that
        // read as the top-picks row randomly changing right before the grid
        // appeared). Each fan card's shared view-transition name still carries
        // it smoothly into wherever it actually lands in the grid — including a
        // pick the deep read decided didn't fit, which just fades out on its
        // own instead of the whole row flashing. The results section already
        // sits at the top of the scroll area — no autoscroll; the page simply
        // resolves in place at the top.
        if (full.ok) {
          withViewTransition(() => {
            setAi({
              ...filterState,
              reranked: !!full.r.reranked,
              results: full.r.results as AiResult[],
            });
            setPhase("done");
          });
        } else {
          withViewTransition(() => setPhase("done")); // screened order + note
        }
      } catch (e) {
        if (seq !== searchSeq.current) return;
        setAskError(e instanceof Error ? e.message : String(e));
        setPhase("idle");
      }
    },
    [askInput, busy]
  );

  const onVoiceFinal = useCallback(
    (text: string) => {
      setAskInput(text);
      runAskSearch(text);
    },
    [runAskSearch]
  );

  const clearAsk = useCallback(() => {
    searchSeq.current++;
    setAi(null);
    setParsed(null);
    setAskError(null);
    setAskInput("");
    setPhase("idle");
    setResultsAsMap(false);
    setWatchSaved(false);
    setLaidCount(0);
    setArmedId(null);
    inputRef.current?.focus();
  }, []);

  /** Save the current search as a standing watch the always-on scout re-runs.
   * On success a little bell flies off the button into the header bell — the
   * bell "collects" the watch — and the header bell flips to a checkmark. */
  const saveWatch = useCallback(async (fromEl?: HTMLElement | null) => {
    if (!activeQuery.trim() || !parsed || watchSaved) return;
    const location = null;
    try {
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: activeQuery, parsed, location }),
      });
      if (res.ok) {
        // stays "Watching" (disabled) for THIS search — no re-watching the same
        // query over and over; a new search re-arms the button.
        setWatchSaved(true);
        window.dispatchEvent(new Event("scout:watches-changed"));
        flyBellToHeader(fromEl ?? null);
      }
    } catch {
      /* offline — silently ignore; the button can be tapped again */
    }
  }, [activeQuery, parsed, watchSaved]);

  const setStatus = useCallback(async (id: string, status: UserDogStatus | null) => {
    const res = await fetch(`/api/dogs/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const patch = (d: DogView) => (d.id === id ? { ...d, userStatus: status } : d);
      setDogs((prev) => (prev ? prev.map(patch) : prev));
      setAi((prev) =>
        prev ? { ...prev, results: prev.results.map((r) => ({ ...r, dog: patch(r.dog) })) } : prev
      );
    }
  }, []);

  const expandedCard = expandedId && expandedDog && (
    <CardExpanded
      dog={expandedDog}
      matchScore={view === "match" && ai?.reranked ? resultById.get(expandedId)?.score : undefined}
      matchReasons={view === "match" ? resultById.get(expandedId)?.reasons : undefined}
      matchCaveats={view === "match" ? resultById.get(expandedId)?.unknowns : undefined}
      originRect={expandedRect}
      plain={expandPlain}
      onClose={() => setExpandedId(null)}
      onSetStatus={setStatus}
    />
  );


  // ------------------------------------------------------------ search box
  const searchBox = (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        runAskSearch();
      }}
    >
      <div className="relative w-full flex-1">
        <textarea
          ref={inputRef}
          value={askInput}
          onChange={(e) => setAskInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              runAskSearch();
            }
          }}
          rows={1}
          // Desktop only: autofocusing on a phone pops the keyboard up (and
          // shifts the whole layout) the instant the page loads, before the
          // user has done anything — a jarring first impression on mobile.
          autoFocus={typeof window !== "undefined" && window.innerWidth >= 768}
          aria-label="Describe the dog you're looking for"
          placeholder={phase === "idle" ? typedHint : "Describe your dog…"}
          // 16px, not 15.5px: iOS Safari auto-zooms the page on focus for any
          // input/textarea rendering text smaller than 16px — a well-known
          // mobile-web gotcha, and especially jarring paired with autoFocus.
          className="block w-full resize-none bg-transparent px-1.5 py-1 text-base leading-normal text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
      </div>
      <MicButton
        size="md"
        disabled={busy}
        onInterim={(t) => setAskInput(t)}
        onFinal={onVoiceFinal}
        onError={(m) => setAskError(m)}
      />
    </form>
  );

  // -------------------------------------------------- live status (under box)
  // One cute, specific line at a time — built from the query's own traits and
  // real candidate names ("Analyzing Sidney's ear floppiness"). No chip wall.
  const cuteLines = useMemo(() => {
    const names = (ai?.results ?? [])
      .map((r) => r.dog.name)
      .filter((n): n is string => !!n)
      .slice(0, 12);
    // Once the structured parse lands, use its precise criteria; until then,
    // build real phrases straight from the raw query so a phrase always follows
    // the first "Scouting…" (never a wall of repeats).
    if (parsed) return screeningLines(parsed, names);
    if (activeQuery.trim()) return screeningLinesForText(activeQuery, names);
    return [];
  }, [parsed, ai, activeQuery]);
  // The live narration under the big query — a SOLID pill so it stays
  // readable no matter which cards are flying behind it.
  const statusLine = busy && (
    <div className="mx-auto mt-5 flex min-h-[2.4rem] max-w-3xl items-center justify-center">
      <Typewriter
        lines={["Scouting…", ...cuteLines]}
        className="font-sans text-[15px] font-semibold tracking-tight text-ink-800"
      />
    </div>
  );

  // ---------------------------------------------------------------- header
  const header = (
    <header className="z-20 flex items-center justify-between gap-3 border-b border-ink-900/[0.06] bg-canvas/70 px-6 py-3 backdrop-blur-md">
      <button
        onClick={() => {
          setView("match");
          clearAsk();
        }}
        className="flex shrink-0 items-center self-stretch"
        title="Back to home"
      >
        <span className="scout-wordmark font-display text-[27px] font-extrabold leading-none tracking-[-0.01em] text-ink-900">
          Scout
        </span>
      </button>

      <nav className="flex shrink-0 items-center gap-1 text-[13px] font-semibold">
        {/* the Scout wordmark (top-left) is the way home / clear — no separate
            Clear button. */}
        {view === "browse" && (
          <>
            <button
              type="button"
              onClick={() => setView("match")}
              className="rounded-full px-3 py-1.5 text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
            >
              Matcher
            </button>
            <Link
              href="/sources"
              className="rounded-full px-3 py-1.5 text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
            >
              Sources
            </Link>
          </>
        )}
        <SavedPanel />
        <WatchesPanel />
      </nav>
    </header>
  );

  // ------------------------------------------------------------ match view
  if (view === "match") {
    const idle = phase === "idle";
    return (
      <div className="relative flex h-full flex-col overflow-hidden">
        {/* the dog-park environment — sky, sun, clouds, rolling hills. Only on
            the idle landing; searching/results run on the clean sky canvas.
            The idle landing is chrome-free (no header) — the scene IS the
            page; the header returns once a search starts (Clear/Browse nav). */}
        {idle && <DogParkScene />}

        {!idle && header}
        <main className="scout-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4">
          {/* a soft pool of light under the orbit, so the search doesn't run in
              a flat void (painted beneath every floater) */}
          {busy && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(46%_40%_at_50%_36%,rgba(255,255,255,0.65),rgba(255,255,255,0)_70%)]"
            />
          )}
          {/* the sift — starts once the screen has picked REAL candidates (the
              short "reading" beat before it is intentional); the upcoming top
              picks board the orbit first so the deal can pluck them out */}
          <SiftLayer
            pool={siftPool}
            active={busy && !!ai}
            excludeIds={reservedIds}
            priority={shortlistDogs.map((d) => d.id)}
            armedId={armedId}
          />

          {/* ---------------------------------------------------------------- */}
          {/* Idle hero — a dog-park scene: the headline sits up in the sky, and  */}
          {/* the prompt + Scout + example tags sit down on the grass.           */}
          {/* ---------------------------------------------------------------- */}
          {idle && (
            <section className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-5 pb-[2vh] pt-[6vh] text-center">
              <div className="group flex w-full max-w-xl flex-col items-center">
                {/* brand lockup — everything on one center axis: Scout the dog
                    perched above the wordmark, a quiet tagline beneath */}
                <div className="scout-rise flex flex-col items-center">
                  {/* the idle dog sits at the SAME screen spot as the searching
                      dog — no view-transition crossfade; on submit the searching
                      dog simply takes its place and raises its binoculars. */}
                  <ScoutMascot className="h-14 w-auto shrink-0 transition-transform duration-500 group-focus-within:-translate-y-0.5 sm:h-[68px]" />
                  <span className="mt-1 font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.03em] text-ink-900 sm:text-[3.1rem]">
                    Scout
                  </span>
                </div>

                {/* the search pill */}
                <div
                  className="scout-rise scout-promptcard relative z-10 mt-7 w-full rounded-full bg-white p-2 pl-6"
                  style={{ animationDelay: "150ms" }}
                >
                  {searchBox}
                </div>

                {/* example tags — four at a time, cycling through the full set;
                    the group is keyed so it fades + rises in on each rotation */}
                <div
                  key={chipStart}
                  className="mt-6 flex min-h-[7.5rem] w-[min(94vw,720px)] flex-wrap content-start justify-center gap-2.5 sm:min-h-[6rem]"
                >
                  {[0, 1, 2, 3].map((i) => {
                    const q = EXAMPLE_QUERIES[(chipStart + i) % EXAMPLE_QUERIES.length];
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => {
                          setAskInput(q);
                          runAskSearch(q);
                        }}
                        style={{ animationDelay: `${i * 145}ms` }}
                        className="scout-chip-in scout-tag inline-flex h-9 cursor-pointer items-center rounded-full border border-terra-600/15 bg-white/90 px-4 text-[13px] font-semibold text-ink-700 shadow-[0_1px_2px_rgba(22,39,30,0.06),0_6px_16px_-8px_rgba(22,39,30,0.18)] backdrop-blur-sm hover:border-terra-500/50 hover:text-ink-900"
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>

                {/* browse */}
                <div className="scout-rise mt-7" style={{ animationDelay: "310ms" }}>
                  <button
                    type="button"
                    onClick={() => setView("browse")}
                    className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-ink-700 underline-offset-4 transition hover:text-ink-900 hover:underline"
                  >
                    Browse all {dogs ? filtered.length.toLocaleString() : ""} adoptable dogs on the map
                    <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Reading + results share a centered column, so the sift orbits a
              stable point and the query text stays put as scores land. */}
          {!idle && (
            <section className="relative mx-auto mt-6 w-full max-w-2xl text-center">
              {/* the reading: everything else recedes — just the request, spoken
                  large, with the candidates rushing around it */}
              {busy && (() => {
                const [qTop, qBot] = splitQueryLines(activeQuery);
                return (
                <div className="relative pt-[13.5vh]">
                  {/* Scout sits at the SAME spot as the idle hero dog, then
                      RAISES its binoculars (scout-binoc-raise) and scans the
                      cards swirling below. Above every orbit band. */}
                  <div className="relative z-[34] mx-auto w-fit">
                    <ScoutMascot searching className="h-14 w-auto sm:h-[68px]" />
                  </div>
                  {/* the reading, below the dog and a notch smaller, split into
                      two lines so the orbit WEAVES through it: front band (z-26)
                      sweeps over both lines, the mid band (z-20) threads between
                      them — under the top line (z-24), over the bottom (z-16) —
                      and the back band (z-6) glides behind. */}
                  <div
                    className="scout-query-text scout-rise relative z-[24] mx-auto mt-3 max-w-[94vw] whitespace-nowrap font-sans text-[clamp(1.3rem,4.4vw,2.4rem)] font-extrabold leading-tight tracking-tight"
                    style={{ viewTransitionName: "scout-query" } as React.CSSProperties}
                  >
                    {qTop}
                  </div>
                  {qBot && (
                    <div className="scout-query-text scout-rise relative z-[16] mx-auto max-w-[94vw] whitespace-nowrap font-sans text-[clamp(1.3rem,4.4vw,2.4rem)] font-extrabold leading-tight tracking-tight">
                      {qBot}
                    </div>
                  )}
                  {/* the live status stays above the whole orbit so it's always readable */}
                  <div className="relative z-40 mt-4">{statusLine}</div>
                </div>
                );
              })()}

              {phase === "done" && ai && (
                <div className="relative z-10">
                  <blockquote
                    className="mx-auto max-w-2xl font-sans text-xl font-bold tracking-tight text-ink-900"
                    style={{ viewTransitionName: "scout-query" } as React.CSSProperties}
                  >
                    {activeQuery}
                  </blockquote>
                  {/* one quiet control row: count · view toggle · refine · watch */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px]">
                    <span className="text-ink-500">
                      <span className="font-bold text-ink-800">{ai.results.length}</span>{" "}
                      {ai.results.length === 1 ? "match" : "matches"}
                      {!ai.reranked && <span className="text-amber-700"> · screened order</span>}
                    </span>
                    {ai.results.length > 0 && (
                      <span className="flex items-center gap-0.5 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-cream-200">
                        <button
                          type="button"
                          onClick={() => setResultsAsMap(false)}
                          className={`rounded-full px-2.5 py-0.5 text-[12px] transition ${!resultsAsMap ? "bg-terra-500 font-semibold text-white" : "text-ink-500 hover:text-ink-800"}`}
                        >
                          Cards
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultsAsMap(true)}
                          className={`rounded-full px-2.5 py-0.5 text-[12px] transition ${resultsAsMap ? "bg-terra-500 font-semibold text-white" : "text-ink-500 hover:text-ink-800"}`}
                        >
                          Map
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        searchSeq.current++;
                        setAi(null);
                        setParsed(null);
                        setPhase("idle");
                        setAskInput(activeQuery);
                      }}
                      className="font-medium text-ink-500 underline-offset-4 transition hover:text-ink-900 hover:underline"
                    >
                      Refine
                    </button>
                    {ai.results.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => saveWatch(e.currentTarget)}
                        disabled={watchSaved}
                        className="inline-flex items-center gap-1.5 rounded-full bg-terra-500 px-3 py-1 text-[12px] font-bold text-white shadow-sm transition hover:bg-terra-600 disabled:opacity-70"
                      >
                        {watchSaved ? (
                          "Watching"
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                            Watch this search
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {askError && (
            <div className="scout-pop relative z-10 mx-auto mt-4 max-w-xl rounded-xl bg-rose-50 px-4 py-2.5 text-center text-[13px] text-rose-700 ring-1 ring-rose-200">
              {askError}
            </div>
          )}

          {/* the forming shortlist: the live top picks, keyed by id and in the
              app's current best order. As the order sharpens (deterministic →
              true fit) cards re-sort into place, so it always previews exactly
              what leads the grid — and each shares its view-transition name, so
              it flows straight into the grid when the read lands. */}
          {phase === "ranking" && laidDogs.length > 0 && (
            <section className="relative z-30 mx-auto mt-10 w-full max-w-5xl pb-10 text-center">
              <div
                className="flex flex-wrap items-end justify-center sm:flex-nowrap"
                style={{ perspective: "1600px" }}
              >
                {laidDogs.map((d, li) => {
                  const s = cardSeed(d.id);
                  // A hand-fan: rotation + dip grow from the center outward, but
                  // each card is nudged a little ASKEW (seeded jitter in angle,
                  // rise, and slot) so it reads as a real hand of cards, not a
                  // machine-perfect arc. The entrance is the FLIP pluck itself
                  // (flipPluck flies the card in from its orbit position).
                  const off = li - (laidDogs.length - 1) / 2;
                  const jRot = ((s % 100) / 100 - 0.5) * 6; // ±3° askew
                  const jY = ((s >> 5) % 100) / 100 * 8 - 4; // ±4px rise
                  const jX = ((s >> 9) % 100) / 100 * 10 - 5; // ±5px slide
                  return (
                    <div
                      key={d.id}
                      data-fan-card={d.id}
                      className="scout-fan-slot"
                      style={
                        {
                          marginLeft: li > 0 ? "-14px" : undefined, // consistent overlap
                          zIndex: li,
                        } as React.CSSProperties
                      }
                    >
                      {/* inner element carries the fan pose (the FLIP pluck
                          animates the OUTER slot, so the two transforms never
                          clobber) — and re-sorts glide between slots via the
                          transition on .scout-fan */}
                      <div
                        className="scout-fan"
                        style={
                          {
                            "--fan-rot": `${(off * 3.2 + jRot).toFixed(1)}deg`,
                            "--fan-y": `${(off * off * 2.4 + jY).toFixed(1)}px`,
                            "--fan-x": `${jX.toFixed(1)}px`,
                          } as React.CSSProperties
                        }
                      >
                        <div
                          className="aspect-[5/7] w-[104px] sm:w-[clamp(96px,11vw,136px)]"
                          style={{ viewTransitionName: vtName(d.id) } as React.CSSProperties}
                        >
                          {/* sift cards show ONLY the name (bottom-left); breed +
                              stats fade in when the card morphs into the grid */}
                          <CardFace dog={d} showStats={false} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* while matching (pre-shortlist): keep vertical room for the orbit */}
          {busy && laidDogs.length === 0 && <div className="h-[34vh] shrink-0" />}

          {/* results — only once the deep read has landed (no half-baked order) */}
          {phase === "done" && ai && (
            <section id="match-results" className="mx-auto mt-8 w-full max-w-7xl px-1 pb-10 sm:px-4">
              {ai.results.length === 0 ? (
                <div className="mx-auto mt-8 max-w-md text-center">
                  <PawMark className="mx-auto h-8 w-8 text-ink-300" />
                  <p className="mt-3 font-display text-xl font-bold text-ink-900">
                    No dogs matched that search
                  </p>
                  <p className="mt-2 text-sm text-ink-500">
                    Try loosening a constraint — or browse all{" "}
                    {filtered.length.toLocaleString()} adoptable dogs on the map.
                  </p>
                  <button
                    type="button"
                    onClick={() => setView("browse")}
                    className="scout-cta mt-4 rounded-xl bg-terra-500 px-4 py-2 text-[13px] font-bold text-white transition"
                  >
                    Open the map &amp; directory
                  </button>
                </div>
              ) : resultsAsMap ? (
                <div className="h-[68vh] overflow-hidden rounded-2xl shadow-md ring-1 ring-black/10">
                  <MapView dogs={gridDogs} selectedId={selectedId} onSelect={openDog} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {gridDogs.map((d, i) => {
                    return (
                      <div
                        key={d.id}
                        className="scout-liftable relative"
                        style={
                          {
                            ...tiltStyle(d.id, i),
                            // Only the top grid slots share a transition name, so
                            // the shortlist cards that land up top FLY into place
                            // while the rest of the grid just fades in — a calm,
                            // partial hand-off rather than a chaotic mass-morph.
                            viewTransitionName: i < 12 ? vtName(d.id) : undefined,
                          } as React.CSSProperties
                        }
                      >
                        <DogCard
                          dog={d}
                          selected={d.id === selectedId}
                          onExpand={() => openExpanded(d.id)}
                          // cards that morph in (i<12 carry a transition name)
                          // must NOT also run the entrance animation, or they
                          // double-animate and jump; the rest fade/rise in.
                          entranceIndex={i < 12 ? undefined : i}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

        </main>

        {expandedCard}
      </div>
    );
  }

  // ------------------------------------------------------------ browse view
  return (
    <div className="flex h-full flex-col">
      {header}
      <FilterBar filters={filters} onChange={setFilters} count={browseDogs.length} />

      <div className="flex min-h-0 flex-1">
        {/* the map, clean — every marker is an adoptable dog, so no legend */}
        <div className="relative min-w-0 flex-1">
          <MapView dogs={browseDogs} selectedId={selectedId} onSelect={openDog} />
        </div>

        {/* a quiet LIST of dogs — compact rows, click to open the profile */}
        <aside className="scout-scroll w-[440px] shrink-0 overflow-y-auto border-l border-cream-200 bg-white">
          {error && (
            <div className="m-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
              Failed to load dogs: {error}
            </div>
          )}
          {!dogs && !error && (
            <div className="p-8 text-center text-sm text-ink-300">Fetching dogs…</div>
          )}
          {dogs && browseDogs.length === 0 && (
            <div className="p-8 text-center text-sm text-ink-300">
              No dogs match these filters.
              <br />
              Seeded but empty? Run <code className="rounded bg-cream-100 px-1">npm run ingest:all</code>.
            </div>
          )}
          <ul className="divide-y divide-cream-100">
            {browseDogs.map((d) => {
              const breed = d.breedNormalized || d.breedRaw || null;
              const vitals = [
                fmtAge(d.ageMonthsEstimate, d.ageRaw),
                d.sex && d.sex !== "unknown" ? d.sex : null,
                d.weightLbsEstimate ? `${d.weightLbsEstimate} lbs` : d.sizeNormalized,
                d.city,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openDog(d.id)}
                    className={`flex w-full items-center gap-4 px-4 py-3.5 text-left transition ${
                      d.id === selectedId ? "bg-meadow-100/50" : "hover:bg-cream-50"
                    }`}
                  >
                    <DogPhoto
                      src={d.primaryPhotoUrl}
                      alt=""
                      className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16.5px] font-bold text-ink-900">
                        {d.name ?? "Unnamed"}
                      </span>
                      {breed && (
                        <span className="block truncate text-[13.5px] font-medium capitalize text-ink-600">
                          {breed}
                        </span>
                      )}
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-400">{vitals}</span>
                    </span>
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
          {dogs && browseDogs.length > 0 && (
            <p className="px-4 py-4 text-center text-[11px] leading-relaxed text-ink-300">
              Listings come from public shelter/rescue pages and link back to the source.
              Availability changes fast — always verify with the shelter.
            </p>
          )}
        </aside>
      </div>

      {expandedCard}
    </div>
  );
}
