"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DogPhoto } from "./ui";
import { getSaved, removeSaved, SAVED_EVENT, type SavedDog } from "@/lib/savedStore";

/**
 * The hearted shortlist: a small heart in the header (left of the bell) with a
 * count, dropping a panel of the dogs the owner has saved. Reads the
 * localStorage store and refreshes on the `scout:saved-changed` event, so it
 * stays in sync with the heart in the profile. Each row links to the dog's
 * original listing; unheart removes it in place.
 */
export default function SavedPanel() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedDog[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => setSaved(getSaved()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(SAVED_EVENT, refresh);
    return () => window.removeEventListener(SAVED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = saved.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Saved dogs${count ? ` (${count})` : ""}`}
        aria-expanded={open}
        className={`relative flex h-8 w-8 items-center justify-center rounded-full transition ${
          open ? "bg-ink-900/[0.07] text-rose-500" : "text-ink-500 hover:bg-ink-900/[0.05] hover:text-rose-500"
        }`}
      >
        {/* the heart just FILLS when you've saved dogs — no count badge; a badge
            belongs only on the bell, for new agent-found matches */}
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill={count ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
        </svg>
      </button>

      {open && (
        <div className="scout-pop absolute right-0 top-10 z-50 w-[320px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-cream-200 bg-white p-3 text-left shadow-2xl">
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Saved dogs
          </p>
          {count === 0 ? (
            <p className="px-1 pb-1 text-[13px] leading-relaxed text-ink-500">
              No saved dogs yet. Tap the <span className="font-semibold text-rose-500">♥</span> on any
              profile to keep it here.
            </p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
              {saved.map((d) => (
                <li key={d.id} className="group flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-cream-50">
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-2.5"
                  >
                    <DogPhoto src={d.photo} alt="" className="h-11 w-11 shrink-0 overflow-hidden rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink-900">
                        {d.name ?? "Unnamed"}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-400">
                        {[d.breed, d.city].filter(Boolean).join(" · ") || "View listing"}
                      </span>
                    </span>
                  </a>
                  <button
                    type="button"
                    onClick={() => removeSaved(d.id)}
                    aria-label={`Remove ${d.name ?? "dog"}`}
                    className="shrink-0 rounded-full p-1.5 text-ink-300 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
