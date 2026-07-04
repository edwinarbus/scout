"use client";

import { useEffect, useRef, useState } from "react";
import { DogPhoto } from "./ui";

/**
 * A portrait photo carousel for the expanded card's left column. Shows the
 * dog's photos full-height (object-cover on a tall 4:5 frame, so faces aren't
 * cropped the way a short landscape strip did). Auto-advances when there are
 * several, with dot controls and prev/next arrows. Falls back to the paw
 * placeholder via DogPhoto for missing/broken images.
 */
export default function PhotoCarousel({
  photos,
  alt,
}: {
  photos: string[];
  alt: string;
}) {
  const list = photos.length ? photos : [""];
  const [i, setI] = useState(0);
  const multi = list.length > 1;

  // gentle auto-advance
  useEffect(() => {
    if (!multi) return;
    const t = setInterval(() => setI((n) => (n + 1) % list.length), 3200);
    return () => clearInterval(t);
  }, [multi, list.length]);

  const go = (n: number) => setI((n + list.length) % list.length);

  // Swipe left/right to change photo (mobile). Uses touchstart/end deltas, so
  // it works even inside the profile modal, which swallows touchmove elsewhere.
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || !multi) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1); // left → next, right → prev
    touchStartX.current = null;
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-cream-100"
      style={{ touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* stacked slides, cross-faded */}
      {list.map((src, idx) => (
        <div
          key={idx}
          className="absolute inset-0 transition-opacity duration-500"
          style={{ opacity: idx === i ? 1 : 0 }}
          aria-hidden={idx !== i}
        >
          <DogPhoto src={src || null} alt={alt} className="absolute inset-0 h-full w-full" />
        </div>
      ))}

      {multi && (
        <>
          <button
            type="button"
            onClick={() => go(i - 1)}
            aria-label="Previous photo"
            className="absolute left-1.5 top-1/2 z-[3] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(i + 1)}
            aria-label="Next photo"
            className="absolute right-1.5 top-1/2 z-[3] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
          >
            ›
          </button>
          <div className="absolute inset-x-0 bottom-2.5 z-[3] flex justify-center">
            <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-2 py-1.5 backdrop-blur-sm">
              {list.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setI(idx)}
                  aria-label={`Photo ${idx + 1}`}
                  className={`h-1.5 rounded-full shadow-sm transition-all ${
                    idx === i ? "w-4 bg-white" : "w-1.5 bg-white/70 hover:bg-white"
                  }`}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
