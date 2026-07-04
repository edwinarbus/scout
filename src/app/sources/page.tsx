import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adoptionSources, dogListings } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Where the dogs come from — a plain, honest list of the shelters and rescues
 * Scout reads, how many adoptable dogs each currently contributes, and a link
 * to the source's own page. No run-health dashboard, no disabled sources, no
 * dev knobs — just citations for the listings shown across the app.
 */
export default function SourcesPage() {
  const db = getDb();

  const rows = db
    .select({
      id: adoptionSources.id,
      name: adoptionSources.name,
      city: adoptionSources.city,
      region: adoptionSources.region,
      websiteUrl: adoptionSources.websiteUrl,
      listingUrl: adoptionSources.listingUrl,
      dogs: sql<number>`count(case when ${dogListings.staleStatus} in ('available','still_seen') then 1 end)`,
    })
    .from(adoptionSources)
    .leftJoin(dogListings, sql`${dogListings.sourceId} = ${adoptionSources.id}`)
    .where(sql`${adoptionSources.enabled} = 1`)
    .groupBy(adoptionSources.id)
    .all()
    .filter((r) => r.dogs > 0)
    .sort((a, b) => b.dogs - a.dogs);

  return (
    <div className="scout-scroll h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href="/"
          className="text-[13px] font-semibold text-ink-500 underline-offset-4 transition hover:text-ink-900 hover:underline"
        >
          ← Scout
        </Link>

        <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-ink-900">
          Where these dogs come from
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
          Scout watches major shelters and rescues across California.
        </p>

        <ul className="mt-8 divide-y divide-cream-200 border-y border-cream-200">
          {rows.map((r) => {
            const href = r.websiteUrl || r.listingUrl;
            const place = [r.city, r.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)[0];
            return (
              <li key={r.id}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 py-3.5 transition"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink-900 group-hover:text-terra-600">
                      {r.name}
                    </span>
                    {place && <span className="mt-0.5 block text-[12.5px] text-ink-400">{place}</span>}
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-600">
                    {r.dogs.toLocaleString()} <span className="font-normal text-ink-400">dogs</span>
                  </span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:text-terra-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M7 17 17 7M9 7h8v8" />
                  </svg>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
