"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The matcher's status line, rendered as a self-contained pill. Each phrase
 * TYPES in, holds, then the whole pill fades out and the next phrase types in —
 * so there's never a bare, empty pill sitting between phrases (the old
 * type→erase→empty→type cycle left one). `lines` may grow as the search
 * progresses; the next phrase always reads the latest list. Respects
 * prefers-reduced-motion by cross-fading whole phrases.
 */
export default function Typewriter({
  lines,
  className = "",
}: {
  lines: string[];
  className?: string;
}) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  // Read the LATEST lines without restarting the cycle — the list grows as the
  // search progresses (["Scouting…"] → + real phrases), and re-running the
  // effect would reset the index back to line 0 and retype "Scouting…" again.
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    let li = 0;
    let ci = 0;
    let mode: "type" | "hold" | "out" = "type";
    let cur = "";

    const tick = () => {
      const L = linesRef.current;
      if (!L.length) {
        timer = setTimeout(tick, 300);
        return;
      }
      cur = cur || L[li % L.length];

      if (reduced) {
        setText(L[li % L.length]);
        setShown(true);
        li++;
        cur = "";
        timer = setTimeout(tick, 2400);
        return;
      }

      if (mode === "type") {
        ci++;
        setShown(true);
        setText(cur.slice(0, ci));
        if (ci >= cur.length) {
          mode = "hold";
          timer = setTimeout(tick, 1500);
        } else {
          timer = setTimeout(tick, 36 + Math.random() * 42);
        }
      } else if (mode === "hold") {
        mode = "out";
        timer = setTimeout(tick, 60);
      } else {
        // fade the whole pill out, THEN (while invisible) reset to the next
        // phrase — the empty state never shows.
        setShown(false);
        timer = setTimeout(() => {
          li++;
          ci = 0;
          cur = "";
          mode = "type";
          tick();
        }, 260); // > the 200ms fade, so the swap happens fully faded out
      }
    };
    timer = setTimeout(tick, 150);
    return () => clearTimeout(timer);
    // run ONCE — tick reads linesRef.current for the latest list (deps intentionally empty)
  }, []);

  return (
    <span
      aria-live="polite"
      className={`inline-flex max-w-[92vw] items-center rounded-full bg-white/95 px-4 py-1.5 shadow-md ring-1 ring-ink-900/[0.06] backdrop-blur-sm transition-all duration-200 ${
        shown && text ? "opacity-100 translate-y-0" : "translate-y-1 opacity-0"
      }`}
    >
      <span className={`truncate ${className}`}>{text || " "}</span>
    </span>
  );
}
