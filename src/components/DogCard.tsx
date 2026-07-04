"use client";

import { useRef } from "react";
import type { DogView } from "@/lib/dogView";
import CardFace from "./CardFace";

/**
 * A grid card is the card's FRONT (the shared CardFace) with a gentle
 * pointer-tracking 3D tilt and a holographic sheen on hover-capable devices.
 * Clicking opens the full-size profile (CardExpanded) where status, fit, and
 * the reading live.
 *
 * The lift-on-hover lives on the OUTER wrapper in ScoutApp (.scout-liftable)
 * so there's exactly one lift transform — stacking a second one here made
 * hovering between overlapping cards jump.
 */
export default function DogCard({
  dog,
  selected,
  onExpand,
  entranceIndex,
}: {
  dog: DogView;
  selected: boolean;
  onExpand: () => void;
  /** Staggers the entrance animation (index within the visible grid). */
  entranceIndex?: number;
}) {
  const tiltRef = useRef<HTMLDivElement | null>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return; // touch taps would leave the card skewed
    const el = tiltRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width; // 0..1
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--px", `${((0.5 - py) * 6).toFixed(2)}deg`);
    el.style.setProperty("--py", `${((px - 0.5) * 8).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
  };
  const onPointerLeave = () => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--px", "0deg");
    el.style.setProperty("--py", "0deg");
  };

  return (
    <div
      id={`card-${dog.id}`}
      className={`scout-flip-scene aspect-[5/7] w-full ${
        entranceIndex != null ? "scout-rise" : "scout-pop"
      }`}
      style={
        entranceIndex != null
          ? { animationDelay: `${Math.min(entranceIndex, 12) * 55}ms` }
          : undefined
      }
    >
      <div
        ref={tiltRef}
        className="scout-card-tilt h-full w-full"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <button
          type="button"
          onClick={onExpand}
          aria-label={`${dog.name ?? "Unnamed"} — open the full profile`}
          className={`relative block h-full w-full text-left ${
            selected ? "rounded-[18px] ring-2 ring-terra-500 ring-offset-2 ring-offset-cream-50" : ""
          }`}
        >
          <CardFace dog={dog} showBadges />
          <span aria-hidden className="scout-holo pointer-events-none absolute inset-0 z-[4] rounded-[18px]" />
        </button>
      </div>
    </div>
  );
}
