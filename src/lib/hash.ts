import { createHash } from "node:crypto";

/** Deterministic JSON stringify: object keys sorted at every level. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}

/**
 * Content hash over the fields that constitute "the listing changed".
 * Volatile bookkeeping fields (lastSeenAt, staleStatus, ...) must NOT be
 * included — the caller passes only content fields.
 */
export function contentHash(fields: Record<string, unknown>): string {
  return hashObject(fields);
}

/** Hash of the photo set (URL-based; we do not download image bytes in phase one). */
export function photoHash(photoUrls: string[] | null | undefined): string | null {
  if (!photoUrls || photoUrls.length === 0) return null;
  return hashObject([...photoUrls].sort());
}
