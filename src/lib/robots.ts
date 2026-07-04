import { fetchPage } from "./fetchClient";

/**
 * Minimal robots.txt check, run before every source crawl.
 *
 * This is an operational courtesy check, not a legal judgment. We evaluate
 * the wildcard (*) agent group against the source's listing path using
 * longest-match semantics (Allow wins ties). If the listing path is
 * disallowed, the runner refuses to crawl and flags the source for review.
 * Crawl-delay, when present, is honored as a minimum request delay.
 */

export type RobotsStatus =
  | "allows"
  | "disallows_listing_path"
  | "no_robots"
  | "fetch_error";

export interface RobotsResult {
  status: RobotsStatus;
  crawlDelaySeconds: number | null;
  matchedRule: string | null;
}

interface RobotsGroup {
  agents: string[];
  allows: string[];
  disallows: string[];
  crawlDelay: number | null;
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allows: [], disallows: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allows.push(value);
    else if (field === "disallow") {
      if (value) current.disallows.push(value);
      // empty Disallow = allow everything (no rule to record)
    } else if (field === "crawl-delay") {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    }
  }
  return groups;
}

export function evaluateRobots(text: string, path: string): RobotsResult {
  const groups = parseRobots(text);
  // We only match the wildcard group; Scout's UA is not a known crawler.
  const group = groups.find((g) => g.agents.includes("*"));
  if (!group) return { status: "allows", crawlDelaySeconds: null, matchedRule: null };

  let best: { rule: string; allow: boolean; length: number } | null = null;
  for (const rule of group.disallows) {
    if (pathMatches(path, rule) && (!best || rule.length > best.length)) {
      best = { rule, allow: false, length: rule.length };
    }
  }
  for (const rule of group.allows) {
    if (pathMatches(path, rule) && (!best || rule.length >= best.length)) {
      best = { rule, allow: true, length: rule.length };
    }
  }
  return {
    status: best && !best.allow ? "disallows_listing_path" : "allows",
    crawlDelaySeconds: group.crawlDelay,
    matchedRule: best?.rule ?? null,
  };
}

function pathMatches(path: string, rule: string): boolean {
  // Supports '*' wildcards and '$' end anchors (Google-style extensions).
  const escaped = rule
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const anchored = escaped.endsWith("\\$")
    ? escaped.slice(0, -2) + "$"
    : escaped;
  return new RegExp("^" + anchored).test(path);
}

const robotsCache = new Map<string, { text: string | null; fetchedAt: number }>();

/** Fetch (with in-process cache) and evaluate robots.txt for a listing URL. */
export async function checkRobots(
  listingUrl: string,
  opts: { browserHeaders?: boolean } = {}
): Promise<RobotsResult> {
  const url = new URL(listingUrl);
  const robotsUrl = `${url.origin}/robots.txt`;
  let entry = robotsCache.get(url.origin);
  if (!entry || Date.now() - entry.fetchedAt > 6 * 3600_000) {
    try {
      const res = await fetchPage(robotsUrl, {
        retries: 1,
        requestDelayMs: 1000,
        browserHeaders: opts.browserHeaders,
      });
      entry = {
        text: res.ok && res.status === 200 ? res.text : null,
        fetchedAt: Date.now(),
      };
      if (!res.ok && res.status !== 404 && res.status !== 403) {
        // Unexpected failure — don't cache hard, treat as fetch_error below.
        robotsCache.delete(url.origin);
        return { status: "fetch_error", crawlDelaySeconds: null, matchedRule: null };
      }
    } catch {
      return { status: "fetch_error", crawlDelaySeconds: null, matchedRule: null };
    }
    robotsCache.set(url.origin, entry);
  }
  if (entry.text == null) {
    return { status: "no_robots", crawlDelaySeconds: null, matchedRule: null };
  }
  return evaluateRobots(entry.text, url.pathname + url.search);
}
