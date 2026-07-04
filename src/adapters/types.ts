import type { AdoptionSourceRow } from "@/db/schema";
import type { FetchOptions, FetchPageResult } from "@/lib/fetchClient";
import type { AdapterResult, SourceSystem } from "@/lib/types";

/**
 * Adapters are the core of Scout. Each one knows how to crawl ONE kind of
 * source system: find the listing page(s), page through every result, open
 * detail pages when cards are thin, and emit ExtractedDog records with raw
 * values preserved.
 *
 * Contract:
 *  - Fetch through ctx.fetch/ctx.fetchJson only (politeness settings applied).
 *  - Respect ctx.limits; if a limit truncates the crawl, say so via a warning
 *    and paginationCompleted/detailExtractionCompleted = false.
 *  - Never guess field values. Missing = null. Raw text goes in rawPayload.
 *  - Ask ctx.shouldFetchDetail before fetching a detail page — it returns
 *    false when we already have detail data for an unchanged card.
 *  - Fail loudly (throw) only when the whole source is unusable; per-dog
 *    problems become warnings.
 */
export interface AdapterContext {
  source: AdoptionSourceRow;
  fetch: (url: string, opts?: Partial<FetchOptions>) => Promise<FetchPageResult>;
  fetchJson: <T = unknown>(
    url: string,
    opts?: Partial<FetchOptions>
  ) => Promise<{ status: number; data: T }>;
  log: (message: string) => void;
  /** True unless the listing's card is unchanged AND we already fetched its detail before. */
  shouldFetchDetail: (listingKey: string, cardFingerprint: string) => boolean;
  limits: { maxPages: number; maxDetailPages: number };
  /** Persist a raw capture (HTML/JSON) for post-mortem parser debugging. */
  saveDebug: (name: string, content: string) => void;
}

export interface SourceAdapter {
  system: SourceSystem;
  parserVersion: string;
  crawl(ctx: AdapterContext): Promise<AdapterResult>;
}
