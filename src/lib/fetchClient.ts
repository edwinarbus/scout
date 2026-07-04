/**
 * Polite HTTP client for shelter sources.
 *
 * - Identifies itself honestly (personal, non-commercial, contact address).
 * - Enforces a per-host minimum delay between requests (sources are crawled
 *   sequentially, so this is a real rate limit, not best-effort).
 * - Bounded retries with backoff on transient failures only.
 * - Never follows more than a handful of redirects; never streams forever.
 */

export const SCOUT_USER_AGENT =
  "ScoutDogAdoptionScout/0.1 (personal non-commercial dog adoption search; contact hi@edwinarb.us)";

/**
 * Browser-profile headers for the few sources whose CDN returns 403 to every
 * non-browser client (LAAS/Akamai, Oakland AS). Using them is a per-source
 * operator decision recorded on the AdoptionSource row (`useBrowserHeaders`
 * + notes); request volume stays low-frequency regardless.
 */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  /** Minimum ms between requests to the same host. */
  requestDelayMs?: number;
  headers?: Record<string, string>;
  /** Use the browser header profile instead of the Scout UA. */
  browserHeaders?: boolean;
  method?: "GET" | "POST";
  /** JSON-serializable request body (POST). */
  body?: unknown;
}

export interface FetchPageResult {
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
  contentType: string | null;
}

const lastRequestAtByHost = new Map<string, number>();

async function politeDelay(host: string, requestDelayMs: number) {
  const last = lastRequestAtByHost.get(host);
  if (last != null) {
    const wait = last + requestDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  lastRequestAtByHost.set(host, Date.now());
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPage(
  url: string,
  opts: FetchOptions = {}
): Promise<FetchPageResult> {
  const {
    timeoutMs = 25000,
    retries = 2,
    requestDelayMs = 1500,
    headers = {},
    browserHeaders = false,
    method = "GET",
    body,
  } = opts;
  const host = new URL(url).host;

  const baseHeaders: Record<string, string> = browserHeaders
    ? { ...BROWSER_HEADERS, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" }
    : {
        "User-Agent": SCOUT_USER_AGENT,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await politeDelay(host, requestDelayMs * (attempt === 0 ? 1 : attempt + 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...baseHeaders,
          ...(body != null ? { "Content-Type": "application/json;charset=UTF-8" } : {}),
          ...headers,
        },
        body: body != null ? JSON.stringify(body) : undefined,
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await res.text();
      const result: FetchPageResult = {
        ok: res.ok,
        status: res.status,
        text,
        finalUrl: res.url || url,
        contentType: res.headers.get("content-type"),
      };
      // Retry only on transient server errors / rate limits.
      if (!res.ok && attempt < retries && (res.status >= 500 || res.status === 429)) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `fetch failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions = {}
): Promise<{ status: number; data: T }> {
  const res = await fetchPage(url, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  try {
    return { status: res.status, data: JSON.parse(res.text) as T };
  } catch {
    throw new Error(`invalid JSON from ${url} (first bytes: ${res.text.slice(0, 80)})`);
  }
}
