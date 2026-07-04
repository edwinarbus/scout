import type { MetadataRoute } from "next";

/**
 * Scout is a personal, single-user tool — it should never show up in search
 * results. Disallowing everything here is belt-and-suspenders alongside the
 * per-page `robots: noindex` metadata and the X-Robots-Tag response header
 * (next.config.ts): this stops crawlers from even fetching pages, the other
 * two stop indexing if a page gets fetched anyway.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
