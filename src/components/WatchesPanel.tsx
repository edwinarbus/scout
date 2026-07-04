"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The standing-watches control: a small bell in the HEADER (top right) that
 * drops a panel to manage the searches the overnight scout re-runs, see
 * whether text alerts are configured, and fire a test text. Fully
 * self-contained — it fetches its own data and refreshes when ScoutApp saves
 * a new watch (a window event).
 *
 * Everything hides gracefully: if the server reports SMS isn't configured
 * (no Twilio keys), the panel explains how to enable it and the rest still works.
 */

interface WatchItem {
  id: number;
  label: string;
  query: string;
  active: boolean;
  createdAt: number;
  lastCheckedAt: number | null;
  lastNotifiedAt: number | null;
  notifiedCount: number;
}

interface SmsState {
  enabled: boolean;
  to: string;
}

export default function WatchesPanel() {
  const [open, setOpen] = useState(false);
  const [sms, setSms] = useState<SmsState | null>(null);
  const [watchList, setWatchList] = useState<WatchItem[]>([]);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // A dropdown should dismiss like one: click anywhere outside or press
  // Escape and it closes.
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

  const refreshWatches = useCallback(async () => {
    try {
      const res = await fetch("/api/watches");
      if (res.ok) setWatchList(((await res.json()).watches as WatchItem[]) ?? []);
    } catch {
      /* offline — leave list as-is */
    }
  }, []);

  // Learn whether text alerts are configured.
  useEffect(() => {
    fetch("/api/sms")
      .then((r) => r.json())
      .then((cfg) => setSms({ enabled: !!cfg.enabled, to: cfg.to ?? "" }))
      .catch(() => setSms({ enabled: false, to: "" }));
  }, []);

  useEffect(() => {
    refreshWatches();
    const onChange = () => refreshWatches();
    window.addEventListener("scout:watches-changed", onChange);
    return () => window.removeEventListener("scout:watches-changed", onChange);
  }, [refreshWatches]);

  // "Run now": trigger the scout on demand — it finds the current top-fit dog
  // for the newest saved search and texts it right away, as if an agent run
  // had just surfaced it.
  const runNow = useCallback(async () => {
    setTestMsg("Running the scout…");
    try {
      const res = await fetch("/api/watches/run-now", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestMsg(`Texted you about ${data.dog} — check your phone.`);
        refreshWatches();
      } else {
        setTestMsg(data.error ?? "Couldn't send — check your Twilio keys.");
      }
    } catch {
      setTestMsg("Couldn't send.");
    }
    setTimeout(() => setTestMsg(null), 6000);
  }, [refreshWatches]);

  const deleteWatch = useCallback(
    async (w: WatchItem) => {
      await fetch(`/api/watches/${w.id}`, { method: "DELETE" });
      refreshWatches();
      // tell the matcher which query was un-watched, so if you're looking at
      // that search's results the "Watching" button re-arms to "Watch this search".
      window.dispatchEvent(new CustomEvent("scout:watch-deleted", { detail: { query: w.query } }));
    },
    [refreshWatches]
  );

  // "Collect" feedback: when a watch is saved, a bell flies up from the button
  // into this header bell (see flyBellToHeader) — on arrival the bell flips to
  // a checkmark for a beat, then settles back to a bell.
  const [collected, setCollected] = useState(false);
  const collectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const onCollected = () => {
      setCollected(true);
      refreshWatches();
      if (collectTimer.current) clearTimeout(collectTimer.current);
      collectTimer.current = setTimeout(() => setCollected(false), 1600);
    };
    window.addEventListener("scout:watch-collected", onCollected);
    return () => {
      window.removeEventListener("scout:watch-collected", onCollected);
      if (collectTimer.current) clearTimeout(collectTimer.current);
    };
  }, [refreshWatches]);

  // The bell badge means ONE thing: dogs the always-on agent newly matched for
  // your saved searches. It's the running total of agent alerts minus what
  // you've already seen (opening the panel marks them seen), so it clears once
  // you've looked — never a count of how many watches you have.
  const totalMatched = watchList.reduce((n, w) => n + (w.notifiedCount || 0), 0);
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    const v = Number(localStorage.getItem("scout:watch-seen") || "0");
    setSeen(Number.isFinite(v) ? v : 0);
  }, []);
  useEffect(() => {
    if (open && totalMatched > seen) {
      localStorage.setItem("scout:watch-seen", String(totalMatched));
      setSeen(totalMatched);
    }
  }, [open, totalMatched, seen]);
  const newMatches = Math.max(0, totalMatched - seen);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications and watches"
        aria-expanded={open}
        className={`relative flex h-8 w-8 items-center justify-center rounded-full transition ${
          open ? "bg-ink-900/[0.07] text-ink-900" : "text-ink-500 hover:bg-ink-900/[0.05] hover:text-ink-900"
        }`}
      >
        {collected ? (
          <svg viewBox="0 0 24 24" className="scout-pop h-[18px] w-[18px] text-terra-600" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        )}
        {newMatches > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-terra-500 px-0.5 text-[9px] font-extrabold leading-none text-white ring-2 ring-canvas">
            {newMatches}
          </span>
        )}
      </button>

      {open && (
        <div className="scout-pop absolute right-0 top-10 z-50 w-[340px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-cream-200 bg-white p-4 text-left shadow-2xl">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-[17px] font-extrabold leading-tight text-ink-900">Autonomous Scout</h2>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
                Claude Managed Agents watch shelters daily for your saved searches.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="-mr-1 mt-0.5 shrink-0 rounded-full p-1 text-ink-400 hover:bg-ink-900/5 hover:text-ink-700"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {/* Text-alert status */}
          <div className="rounded-xl bg-cream-100 p-3">
            {sms === null ? (
              <p className="text-[13px] text-ink-500">Checking text alerts…</p>
            ) : sms.enabled ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-bold text-ink-900">Text alerts on</p>
                  <p className="text-[12px] text-ink-500">
                    {testMsg ?? `New matches are texted to ${sms.to || "your phone"}.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runNow}
                  className="shrink-0 rounded-full bg-ink-900/10 px-3.5 py-1.5 text-[13px] font-bold text-ink-700 transition hover:bg-ink-900/15"
                >
                  Run now
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-ink-500">
                Text alerts aren&apos;t set up. Add your Twilio keys (
                <code className="rounded bg-white px-1">SCOUT_TWILIO_*</code>) to{" "}
                <code className="rounded bg-white px-1">.env.local</code>.
              </p>
            )}
          </div>

          {/* Watches */}
          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Standing watches
          </p>
          {watchList.length === 0 ? (
            <p className="text-[13px] text-ink-500">
              No watches yet. Run a search, then tap <span className="font-semibold text-ink-700">Watch this search</span>{" "}
              to have Scout look overnight.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {watchList.map((w) => (
                <li key={w.id} className="rounded-xl border border-cream-200 bg-white p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    {/* full search text, wrapping onto as many lines as it needs */}
                    <p className="min-w-0 flex-1 text-[13.5px] font-bold leading-snug text-ink-900">
                      {w.label}
                    </p>
                    <button
                      type="button"
                      onClick={() => deleteWatch(w)}
                      aria-label={`Delete ${w.label}`}
                      className="mt-0.5 shrink-0 self-start rounded-full p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
