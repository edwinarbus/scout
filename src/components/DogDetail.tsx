"use client";

import { useEffect, useState } from "react";
import type { DogView } from "@/lib/dogView";
import type { UserDogStatus } from "@/lib/types";
import {
  DogPhoto,
  LONG_STAY_DAYS,
  STATUS_LABELS,
  StatusPill,
  TriBadge,
  USER_STATUS_META,
  fmtAge,
  fmtRel,
  trustWarnings,
} from "./ui";

const ACTION_ORDER: UserDogStatus[] = [
  "saved",
  "maybe",
  "contacted",
  "not_a_fit",
  "adopted_elsewhere",
  "hidden",
];

export default function DogDetail({
  dog,
  onClose,
  onSetStatus,
}: {
  dog: DogView;
  onClose: () => void;
  onSetStatus: (id: string, status: UserDogStatus | null) => Promise<void>;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const photos = dog.photoUrls.length ? dog.photoUrls : [dog.primaryPhotoUrl].filter(Boolean) as string[];

  const facts: Array<[string, string | null]> = [
    ["Breed", dog.breedNormalized ?? dog.breedRaw],
    ["Age", fmtAge(dog.ageMonthsEstimate, dog.ageRaw) ?? dog.ageRaw],
    ["Sex", dog.sex === "unknown" ? null : dog.sex],
    ["Size", dog.sizeNormalized ?? dog.sizeRaw],
    ["Weight", dog.weightRaw ?? (dog.weightLbsEstimate ? `${dog.weightLbsEstimate} lbs` : null)],
    ["Color", dog.colorsNormalized.length ? dog.colorsNormalized.join(", ") : dog.colorRaw],
    ["Status", `${STATUS_LABELS[dog.statusNormalized]}${dog.statusRaw ? ` (source: “${dog.statusRaw}”)` : ""}`],
    ["Intake date", dog.intakeDate],
    [
      "Days in shelter",
      dog.daysInShelter != null
        ? `${dog.daysInShelter} days${dog.daysInShelter >= LONG_STAY_DAYS ? " — long-stay" : ""}`
        : null,
    ],
    ["Available from", dog.availabilityDate],
    ["Adoption fee", dog.adoptionFee],
    ["Energy", dog.energyLevel],
    ["Animal ID", dog.sourceAnimalId],
    ["Location", [dog.shelterLocationName ?? dog.shelterName, dog.city, dog.county].filter(Boolean).join(" · ")],
    ["Map precision", dog.latitude != null ? dog.geocodePrecision.replace("_", " ") : "no coordinates"],
  ];

  const setStatus = async (s: UserDogStatus | null) => {
    setBusy(true);
    try {
      await onSetStatus(dog.id, s);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${dog.name ?? "Unnamed"} — full profile`}
    >
      <div
        className="scout-pop flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-cream-50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-cream-200 bg-white px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-semibold">{dog.name ?? "Unnamed"}</h2>
              <StatusPill dog={dog} />
              {dog.matchedSearches.length > 0 && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
                  ★ matches “{dog.matchedSearches[0]}”
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-ink-500">
              {dog.breedNormalized ?? dog.breedRaw ?? "breed unknown"} ·{" "}
              {dog.shelterLocationName ?? dog.shelterName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-500 ring-1 ring-cream-200 transition hover:bg-cream-100"
          >
            Close ✕
          </button>
        </div>

        <div className="scout-scroll grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-[1.1fr_1fr]">
          {/* left: photos + bio */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl ring-1 ring-black/5">
              <DogPhoto
                src={photos[photoIdx] ?? null}
                alt={dog.name ?? "dog"}
                className="aspect-[4/3] w-full"
              />
            </div>
            {photos.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((p, i) => (
                  <button
                    key={p}
                    onClick={() => setPhotoIdx(i)}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                      i === photoIdx ? "ring-terra-500" : "ring-transparent hover:ring-cream-200"
                    }`}
                  >
                    <DogPhoto src={p} alt="" className="h-full w-full" />
                  </button>
                ))}
              </div>
            )}

            {(dog.urgentNotes || dog.holdNotes || dog.fosterNotes || dog.specialNeeds) && (
              <div className="space-y-2">
                {dog.urgentNotes && <Note tone="rose" label="Urgent" text={dog.urgentNotes} />}
                {dog.holdNotes && <Note tone="amber" label="Hold" text={dog.holdNotes} />}
                {dog.fosterNotes && <Note tone="sky" label="Foster" text={dog.fosterNotes} />}
                {dog.specialNeeds && <Note tone="violet" label="Special needs" text={dog.specialNeeds} />}
              </div>
            )}

            {(dog.biographyRaw ?? dog.description) && (
              <div>
                <h3 className="mb-1.5 font-display text-lg font-semibold">About</h3>
                <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-700">
                  {dog.biographyRaw ?? dog.description}
                </p>
              </div>
            )}

            {dog.ai && (
              <div className="rounded-2xl bg-violet-50/60 p-3 ring-1 ring-violet-200">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[11px] font-bold text-white">
                    ✨ AI photo read
                  </span>
                  <span className="text-[11px] text-ink-400">
                    {dog.ai.model}
                    {dog.ai.confidence != null ? ` · ${Math.round(dog.ai.confidence * 100)}% conf.` : ""}
                  </span>
                </div>
                {dog.ai.visualDescription && (
                  <p className="text-[13px] leading-relaxed text-ink-700">{dog.ai.visualDescription}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[
                    dog.ai.apparentSize ? `~${dog.ai.apparentSize}` : null,
                    dog.ai.coatLength ? `${dog.ai.coatLength} coat` : null,
                    dog.ai.coatTexture,
                    ...dog.ai.tags,
                    ...dog.ai.apparentColors,
                  ]
                    .filter(Boolean)
                    .map((t, i) => (
                      <span
                        key={`${t}-${i}`}
                        className="rounded-full bg-white px-2 py-0.5 text-[11px] text-violet-700 ring-1 ring-violet-200"
                      >
                        {t}
                      </span>
                    ))}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink-400">
                  Generated by Claude from one photo — a visual impression, not a shelter fact or
                  breed determination. Verify with the shelter.
                  {dog.ai.photoQuality && dog.ai.photoQuality !== "clear"
                    ? ` (photo flagged: ${dog.ai.photoQuality.replace(/_/g, " ")})`
                    : ""}
                </p>
              </div>
            )}
          </div>

          {/* right: facts, actions, attribution */}
          <div className="space-y-4">
            {/* verification reminder — always visible */}
            <div className="rounded-2xl bg-honey-400/15 p-3 text-[13px] leading-snug text-ink-700 ring-1 ring-honey-400/40">
              <strong>Verify before acting:</strong> listings change fast and scrapes can lag or
              miss updates. Confirm availability and status with{" "}
              <span className="font-semibold">{dog.source.name}</span> using the original listing
              below before falling in love.
            </div>

            {trustWarnings(dog).length > 0 && (
              <div className="rounded-2xl bg-rose-50 p-3 text-[13px] text-rose-700 ring-1 ring-rose-200">
                <ul className="list-inside list-disc space-y-1">
                  {trustWarnings(dog).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <a
              href={dog.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl bg-terra-500 px-4 py-3 text-center text-[15px] font-semibold text-white shadow-sm transition hover:bg-terra-600"
            >
              View original listing at {dog.source.name} ↗
            </a>

            {/* user actions */}
            <div>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                Your status
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {ACTION_ORDER.map((s) => (
                  <button
                    key={s}
                    disabled={busy}
                    onClick={() => setStatus(dog.userStatus === s ? null : s)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition disabled:opacity-50 ${
                      dog.userStatus === s
                        ? "bg-ink-900 text-white ring-ink-900"
                        : "bg-white text-ink-700 ring-cream-200 hover:bg-cream-100"
                    }`}
                  >
                    {USER_STATUS_META[s].emoji} {USER_STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* facts */}
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
              <dl className="divide-y divide-cream-100">
                {facts
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex gap-3 px-4 py-2 text-[13px]">
                      <dt className="w-28 shrink-0 font-medium text-ink-500">{k}</dt>
                      <dd className="capitalize-first text-ink-900">{v}</dd>
                    </div>
                  ))}
              </dl>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <TriBadge label="dogs" value={dog.goodWithDogs} />
              <TriBadge label="cats" value={dog.goodWithCats} />
              <TriBadge label="kids" value={dog.goodWithKids} />
              <TriBadge label="house-trained" value={dog.houseTrained} />
              <TriBadge label="apartment ok" value={dog.apartmentFriendly} />
              <TriBadge label="fixed" value={dog.spayedNeutered} />
              <TriBadge label="vaccinated" value={dog.vaccinated} />
              <TriBadge label="microchipped" value={dog.microchipped} />
            </div>

            {/* attribution + contact (inherited from source unless overridden) */}
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">{dog.source.name}</h3>
                <span className="rounded bg-cream-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-ink-500">
                  {dog.source.system}
                </span>
              </div>
              <ul className="space-y-1 text-[13px] text-ink-700">
                {dog.contact.phone && (
                  <li>
                    ☎ {dog.contact.phone}
                    {dog.contact.phoneIsOverride && (
                      <span className="ml-1 text-[11px] text-ink-300">(dog-specific)</span>
                    )}
                  </li>
                )}
                {dog.contact.email && (
                  <li>
                    ✉{" "}
                    <a className="underline decoration-cream-200 underline-offset-2" href={`mailto:${dog.contact.email}`}>
                      {dog.contact.email}
                    </a>
                    {dog.contact.emailIsOverride && (
                      <span className="ml-1 text-[11px] text-ink-300">(dog-specific)</span>
                    )}
                  </li>
                )}
                {dog.source.websiteUrl && <ExtLink href={dog.source.websiteUrl} label="Shelter website" />}
                {dog.contact.adoptionProcessUrl && (
                  <ExtLink href={dog.contact.adoptionProcessUrl} label="Adoption process" />
                )}
                {dog.contact.adoptionApplicationUrl && (
                  <ExtLink href={dog.contact.adoptionApplicationUrl} label="Adoption application" />
                )}
                {dog.contact.contactUrl && <ExtLink href={dog.contact.contactUrl} label="Contact page" />}
              </ul>
              <p className="mt-2 border-t border-cream-100 pt-2 text-[11px] leading-snug text-ink-300">
                Data collected {fmtRel(dog.lastSeenAt)} from the source above for personal,
                non-commercial use. The shelter’s original listing is the source of truth. Scout
                never contacts shelters automatically.
              </p>
            </div>

            {dog.duplicates.length > 0 && (
              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                  Possibly the same dog at other sources
                </h3>
                <ul className="space-y-1 text-[13px]">
                  {dog.duplicates.map((d) => (
                    <li key={d.id}>
                      <a
                        href={d.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terra-600 underline decoration-cream-200 underline-offset-2 hover:text-terra-500"
                      >
                        {d.sourceName} ↗
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-ink-300">
                  Scout merges aggressively when listings look similar — verify with each source.
                </p>
              </div>
            )}

            <div className="px-1 text-[11px] leading-relaxed text-ink-300">
              First seen {fmtRel(dog.firstSeenAt)} · last checked {fmtRel(dog.lastSeenAt)}
              {dog.missingSince ? ` · missing since ${fmtRel(dog.missingSince)}` : ""} · source run:{" "}
              {dog.source.lastRunStatus ?? "n/a"}{" "}
              {dog.source.lastRunAt ? `(${fmtRel(dog.source.lastRunAt)})` : ""}
              {dog.source.lastRunConfidence != null
                ? ` · confidence ${dog.source.lastRunConfidence}`
                : ""}
              {` · backfill: ${dog.source.backfillStatus}`}
              {dog.source.lastRunMissingUpdatesApplied === false
                ? " · stale statuses frozen after last run"
                : ""}
              {` · dedupe key: ${dog.dedupeMethod === "source_animal_id" ? "animal ID" : "listing URL"}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Note({ tone, label, text }: { tone: "rose" | "amber" | "sky" | "violet"; label: string; text: string }) {
  const tones = {
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    sky: "bg-sky-50 text-sky-800 ring-sky-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
  };
  return (
    <div className={`rounded-xl px-3 py-2 text-[13px] ring-1 ${tones[tone]}`}>
      <span className="font-semibold">{label}: </span>
      {text}
    </div>
  );
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-terra-600 underline decoration-cream-200 underline-offset-2 hover:text-terra-500"
      >
        {label} ↗
      </a>
    </li>
  );
}
