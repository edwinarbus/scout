"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { breedInfo } from "@/lib/breeds";

/**
 * The dog's breed, rendered inline. When we recognize the breed, hovering
 * shows a small tooltip with a plain-language note on what the breed is like.
 *
 * The tooltip is PORTALED to <body> with fixed positioning so it floats over
 * everything (the photo, the card, the modal — nothing clips it), follows the
 * cursor as it moves along the breed text, flips above/below the cursor based
 * on available space, and clamps horizontally so it is always fully visible.
 */

interface TipPos {
  x: number;
  y: number;
  above: boolean;
}

export default function BreedTip({ breed }: { breed: string }) {
  const info = breedInfo(breed);
  const [pos, setPos] = useState<TipPos | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  if (!info) return <span>{breed}</span>;

  const track = (e: React.MouseEvent) => {
    const margin = 10;
    const gap = 16; // between cursor and tooltip
    // measured after first paint; a sane estimate covers the first frame
    const w = tipRef.current?.offsetWidth ?? 272;
    const h = tipRef.current?.offsetHeight ?? 92;
    const x = Math.max(margin + w / 2, Math.min(window.innerWidth - margin - w / 2, e.clientX));
    const spaceAbove = e.clientY - gap - margin;
    const spaceBelow = window.innerHeight - e.clientY - gap - margin;
    const above = spaceAbove >= h ? true : spaceBelow >= h ? false : spaceAbove >= spaceBelow;
    setPos({ x, y: above ? e.clientY - gap : e.clientY + gap, above });
  };

  return (
    <span
      className="inline-block"
      onMouseEnter={track}
      onMouseMove={track}
      onMouseLeave={() => setPos(null)}
    >
      <span className="cursor-help font-medium text-ink-600 decoration-dotted decoration-ink-300 underline-offset-[3px] [text-decoration-line:underline] hover:text-ink-800">
        {breed}
      </span>
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="pointer-events-none fixed z-[200] w-[272px] rounded-xl bg-ink-900 px-3.5 py-2.5 text-left shadow-2xl ring-1 ring-black/20"
            style={{
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? "-100%" : "0%"})`,
            }}
          >
            <span className="block text-[12.5px] font-bold text-white">{info.name}</span>
            <span className="mt-0.5 block text-[12px] font-normal leading-relaxed text-white/75">
              {info.blurb}
            </span>
          </div>,
          document.body
        )}
    </span>
  );
}
