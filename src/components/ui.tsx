"use client";

import { useEffect, useState } from "react";
import type { DogView } from "@/lib/dogView";
import type { StatusNormalized, UserDogStatus } from "@/lib/types";
import { isPlaceholderDimension } from "@/lib/photo";

/** Fired when an image fails to load or resolves to a known placeholder graphic;
 *  ScoutApp listens and drops the dog from results. Detail is the image URL. */
export const PHOTO_BROKEN_EVENT = "scout:photo-broken";

/** Shared presentation helpers (client-side). */

export function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function fmtAge(months: number | null, raw: string | null): string | null {
  if (months == null) {
    if (!raw) return null;
    return raw.length > 24 ? null : raw;
  }
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}

/** Compact length-of-stay label, e.g. "3d", "6w", "128d", "1.4y". */
export function fmtStay(days: number | null): string | null {
  if (days == null) return null;
  if (days < 7) return `${days}d`;
  if (days < 90) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${days}d`;
  return `${(days / 365).toFixed(1)}y`;
}

/** ≥120 days waiting is a "long-stay" scout signal worth surfacing. */
export const LONG_STAY_DAYS = 120;

export type StatusGroup = "available" | "pending" | "gone" | "unknown";

export function statusGroup(s: StatusNormalized): StatusGroup {
  switch (s) {
    case "available":
    case "foster":
      return "available";
    case "pending":
    case "hold":
    case "stray_hold":
    case "medical_hold":
    case "rescue_only":
      return "pending";
    case "adopted":
    case "not_available":
      return "gone";
    default:
      return "unknown";
  }
}

export const STATUS_LABELS: Record<StatusNormalized, string> = {
  available: "Available",
  pending: "Pending",
  hold: "On hold",
  stray_hold: "Stray hold",
  medical_hold: "Medical hold",
  rescue_only: "Rescue only",
  foster: "In foster",
  adopted: "Adopted",
  not_available: "Not available",
  unknown: "Status unknown",
};

/** Marker/chip color per dog, in priority order (user intent → match → freshness → status). */
export function dogColor(dog: DogView): { color: string; label: string } {
  if (dog.userStatus === "contacted") return { color: "#3b82f6", label: "Contacted" };
  if (dog.userStatus === "saved") return { color: "#ec4899", label: "Saved" };
  if (dog.matchedSearches.length > 0) return { color: "#8b5cf6", label: "Strong match" };
  if (dog.freshness === "missing" || dog.freshness === "stale")
    return { color: "#9ca3af", label: "Missing / stale" };
  const g = statusGroup(dog.statusNormalized);
  if (g === "pending") return { color: "#f59e0b", label: "Pending / hold" };
  if (g === "gone") return { color: "#6b7280", label: "No longer listed" };
  if (g === "unknown") return { color: "#94a3b8", label: "Status unknown" };
  return { color: "#10b981", label: "Available" };
}

/** True when the dog's source's last run didn't conclusively succeed. */
export function sourceUncertain(dog: DogView): boolean {
  if (!dog.source.initializedForDailyMonitoring) return true;
  return (
    dog.source.lastRunStatus != null &&
    dog.source.lastRunStatus !== "success" &&
    dog.source.lastRunStatus !== "success_with_warnings"
  );
}

/** Human-readable trust warnings for a listing. Uncertainty is never hidden. */
export function trustWarnings(dog: DogView): string[] {
  const w: string[] = [];
  if (dog.source.backfillStatus === "never") {
    w.push("This source has never completed a full backfill — inventory coverage is unverified.");
  } else if (!dog.source.initializedForDailyMonitoring) {
    w.push(`Last backfill was ${dog.source.backfillStatus} — daily monitoring is paused for this source.`);
  }
  if (dog.source.lastRunStatus === "partial") {
    w.push("The last check of this source was partial — this dog's info may lag.");
  }
  if (dog.source.lastRunStatus === "failed" || dog.source.lastRunStatus === "blocked") {
    w.push(`The last check of this source ${dog.source.lastRunStatus} — freshness is unknown.`);
  }
  if (dog.weakDedupeKey) {
    w.push("No source animal ID — this dog is tracked by its listing URL (weaker dedupe key).");
  }
  if (dog.possibleDuplicate) {
    w.push("May be the same dog as another listing (merged conservatively — verify with each source).");
  }
  if (dog.freshness === "stale" || dog.freshness === "missing") {
    w.push("This listing was absent from recent checks — it may already be adopted.");
  }
  return w;
}

export const USER_STATUS_META: Record<UserDogStatus, { label: string; emoji: string }> = {
  saved: { label: "Saved", emoji: "♥" },
  maybe: { label: "Maybe", emoji: "☆" },
  contacted: { label: "Contacted", emoji: "✉" },
  hidden: { label: "Hidden", emoji: "⨯" },
  not_a_fit: { label: "Not a fit", emoji: "–" },
  adopted_elsewhere: { label: "Adopted elsewhere", emoji: "✓" },
};

export function StatusPill({ dog }: { dog: DogView }) {
  const { color } = dogColor(dog);
  const label = STATUS_LABELS[dog.statusNormalized];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm ring-1 ring-black/5"
      style={{ color: "#3d3428" }}
      title={dog.statusRaw ? `Source status: ${dog.statusRaw}` : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function FreshBadge({ dog }: { dog: DogView }) {
  const map = {
    fresh: { t: `Seen ${fmtRel(dog.lastSeenAt)}`, c: "text-emerald-700 bg-emerald-50 ring-emerald-200" },
    stale: { t: `Missed last check · seen ${fmtRel(dog.lastSeenAt)}`, c: "text-amber-700 bg-amber-50 ring-amber-200" },
    missing: { t: `Missing since ${fmtRel(dog.missingSince)}`, c: "text-gray-600 bg-gray-100 ring-gray-200" },
    uncertain: { t: "Freshness uncertain", c: "text-slate-600 bg-slate-100 ring-slate-200" },
  } as const;
  const m = map[dog.freshness];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${m.c}`}>
      {m.t}
    </span>
  );
}

const PAW_PLACEHOLDER = (
  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cream-100 to-cream-200">
    <svg viewBox="0 0 24 24" className="h-9 w-9 text-ink-300/50" fill="currentColor" aria-hidden>
      <ellipse cx="12" cy="15.5" rx="4.6" ry="3.7" />
      <ellipse cx="5.6" cy="10.2" rx="1.9" ry="2.5" />
      <ellipse cx="10" cy="6.6" rx="2" ry="2.7" />
      <ellipse cx="14" cy="6.6" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="10.2" rx="1.9" ry="2.5" />
    </svg>
  </div>
);

export function DogPhoto({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]); // re-try when the source changes (carousel)

  const flagBroken = () => {
    setBroken(true);
    if (src && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PHOTO_BROKEN_EVENT, { detail: src }));
    }
  };

  if (!src || broken) {
    return <div className={className}>{PAW_PLACEHOLDER}</div>;
  }
  return (
    // Shelter photo hosts vary; plain <img> avoids proxying their images
    // through our server and tolerates broken URLs gracefully. A successful load
    // that comes back at a known placeholder size (e.g. petharbor's no_pic_d) is
    // treated as broken too, so "image available soon" graphics never show.
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={flagBroken}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (isPlaceholderDimension(img.naturalWidth, img.naturalHeight)) flagBroken();
      }}
      className={`${className ?? ""} object-cover`}
    />
  );
}

export function TriBadge({ label, value }: { label: string; value: boolean | null }) {
  if (value == null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
        value
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-rose-50 text-rose-700 ring-rose-200"
      }`}
    >
      {value ? "✓" : "✗"} {label}
    </span>
  );
}
