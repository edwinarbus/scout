import fs from "node:fs";
import path from "node:path";
import { config as loadEnvFile } from "dotenv";
import { getAnthropic, hasAnthropicCredential } from "./anthropic";
import { candidateBlock, type SearchMatch } from "./aiSearch";

/**
 * Claude Managed Agents integration — the "Scout Watch Curator".
 *
 * The overnight scout's deterministic pipeline finds NEW dogs that match a
 * standing watch's criteria. This layer hands those candidates to a persistent
 * Managed Agent that (a) exercises fuzzy judgment the hard filter can't — is
 * this dog genuinely worth waking someone for? — and (b) writes a warm, specific
 * push blurb grounded ONLY in the provided shelter facts / bio / photo read.
 *
 * Why Managed Agents (not a plain Messages call): the agent is a persistent,
 * versioned object created once and reused across nightly runs, it runs on
 * Anthropic's managed loop + sandbox, and it leaves the door open to per-dog web
 * research (the `agent_toolset_20260401` toolset is attached) without any
 * rewrite. It only ever produces text; it never contacts a shelter.
 *
 * This curator is the STANDARD overnight path, on by default whenever an
 * Anthropic credential is present — it's how every alert gets judged, not an
 * add-on. It still degrades gracefully on any failure (no credential, no beta
 * access, a bad response): curateWatchAlerts() returns null and the caller
 * falls back to the deterministic ranking + reasons, so a rough night for the
 * API is never a rough night for the alert. Opt out entirely with
 * SCOUT_MANAGED_AGENT=0. Model via SCOUT_MANAGED_AGENT_MODEL (default
 * claude-sonnet-5).
 *
 * Agent identity is pinned via SCOUT_CURATOR_AGENT_ID / SCOUT_CURATOR_ENV_ID
 * (provisioned once by `npm run scout:setup-watch-curator`) rather than
 * self-provisioned at runtime: a serverless function's filesystem is
 * read-only outside /tmp, so the local-file cache below can only actually
 * persist in local dev. Without those env vars set, this still works for
 * local CLI runs (self-provisions and caches to disk) but would silently
 * re-provision — and fail to cache — on every single invocation in
 * production.
 */

loadEnvFile({ path: ".env.local" });

export const MODEL = process.env.SCOUT_MANAGED_AGENT_MODEL ?? "claude-sonnet-5";
/** Bump when CURATOR_PROMPT changes so a fresh agent version is created. */
export const CURATOR_PROMPT_VERSION = "1";
const CACHE_PATH = path.join(process.cwd(), "data", "managed-agent.json");

export const CURATOR_PROMPT = `You are Scout's overnight watch curator. A person set up a standing "watch" describing the shelter dog they hope to adopt. Scout's deterministic matcher has already found NEW dogs (freshly listed since the last check) that pass the watch's hard criteria. Your job: decide which are genuinely worth sending a push notification about, and write the notification copy.

You receive the watch request, then one block per candidate dog with: shelter-reported facts, an excerpt of the shelter's bio (when any), and an AI photo read (a single-photo impression, not a verified fact).

For EACH dog you choose to alert on, return:
- "id": the exact id from the block.
- "headline": ≤ 7 words, warm and specific, e.g. "A calm senior chihuahua nearby".
- "blurb": one sentence, ≤ 24 words, grounded ONLY in the provided data, that says why it fits the request. You may note at most one honest caveat ("temperament not verified").

Rules:
- Keep only dogs that genuinely fit the person's intent. Drop weak or borderline matches entirely — a quiet, high-signal alert beats a noisy one. It is fine to return an empty list.
- NEVER invent a fact about a dog. If the data doesn't support a claim, don't make it.
- Do not use any tools; reason from the provided text and respond directly.
- Respond with ONLY a JSON object, no prose, no code fences:
  {"alerts":[{"id":"...","headline":"...","blurb":"..."}]}`;

/** True when the Managed Agent curator can run: on by default with a credential,
 *  opt-out only via SCOUT_MANAGED_AGENT=0. */
export function hasManagedAgent(): boolean {
  return process.env.SCOUT_MANAGED_AGENT !== "0" && hasAnthropicCredential();
}

export interface CuratedAlert {
  id: string;
  headline: string;
  blurb: string;
}

// --- Minimal typing for the beta Managed Agents surface. The installed SDK's
// types may lag the beta, so we assert the documented runtime shape and let any
// mismatch fail at call time (caught → graceful fallback), rather than couple to
// SDK types that might not exist yet. -----------------------------------------
interface MaEventBlock {
  type: string;
  text?: string;
}
interface MaEvent {
  type: string;
  content?: MaEventBlock[];
  name?: string;
}
interface MaBetaClient {
  beta: {
    agents: { create(params: unknown): Promise<{ id: string; version: number }> };
    environments: { create(params: unknown): Promise<{ id: string }> };
    sessions: {
      create(params: unknown): Promise<{ id: string }>;
      events: {
        stream(sessionId: string): Promise<AsyncIterable<MaEvent>>;
        send(sessionId: string, params: unknown): Promise<unknown>;
      };
    };
  };
}

interface AgentCache {
  agentId?: string;
  agentModel?: string;
  agentPromptVersion?: string;
  environmentId?: string;
}

/** True when both env-pinned ids are set — the production path. */
function hasEnvPinnedAgent(): boolean {
  return !!(process.env.SCOUT_CURATOR_AGENT_ID && process.env.SCOUT_CURATOR_ENV_ID);
}

function readCache(): AgentCache {
  if (hasEnvPinnedAgent()) {
    // Fully pinned out-of-band (see scripts/setup-watch-curator.ts) — report
    // it as already matching MODEL/CURATOR_PROMPT_VERSION so ensureAgent()
    // below never attempts a runtime create/recreate against a read-only fs.
    // Rotating the model means re-running that script, not an automatic
    // in-request recreation.
    return {
      agentId: process.env.SCOUT_CURATOR_AGENT_ID,
      environmentId: process.env.SCOUT_CURATOR_ENV_ID,
      agentModel: MODEL,
      agentPromptVersion: CURATOR_PROMPT_VERSION,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as AgentCache;
  } catch {
    return {};
  }
}
function writeCache(c: AgentCache) {
  if (hasEnvPinnedAgent()) return; // nothing to persist — already pinned via env
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2));
}

/**
 * Ensure the curator agent + a cloud environment exist. With
 * SCOUT_CURATOR_AGENT_ID / SCOUT_CURATOR_ENV_ID set, this is a no-op that
 * just returns them. Otherwise (local dev), creates them once and caches
 * their ids in data/managed-agent.json; a changed model or prompt version
 * provisions a fresh agent. Returns the ids to run a session with.
 */
async function ensureAgent(
  client: MaBetaClient
): Promise<{ agentId: string; environmentId: string }> {
  const cache = readCache();

  if (!cache.environmentId) {
    const env = await client.beta.environments.create({
      name: "scout-overnight",
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    cache.environmentId = env.id;
  }

  if (
    !cache.agentId ||
    cache.agentModel !== MODEL ||
    cache.agentPromptVersion !== CURATOR_PROMPT_VERSION
  ) {
    const agent = await client.beta.agents.create({
      name: "Scout Watch Curator",
      model: MODEL,
      system: CURATOR_PROMPT,
      // Full toolset attached so per-dog web research can be enabled later; the
      // prompt instructs the curator not to use tools for this task.
      tools: [{ type: "agent_toolset_20260401" }],
    });
    cache.agentId = agent.id;
    cache.agentModel = MODEL;
    cache.agentPromptVersion = CURATOR_PROMPT_VERSION;
  }

  writeCache(cache);
  return { agentId: cache.agentId!, environmentId: cache.environmentId! };
}

/** Run one curator turn in a fresh session and collect its final text. */
async function runCuratorTurn(client: MaBetaClient, prompt: string): Promise<string> {
  const { agentId, environmentId } = await ensureAgent(client);
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: "Scout overnight watch",
  });

  // Open the stream first, then send the message (the API buffers until the
  // stream attaches — per the Managed Agents docs).
  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: prompt }] }],
  });

  let text = "";
  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content ?? []) text += block.text ?? "";
    } else if (event.type === "session.status_idle") {
      break;
    }
  }
  return text;
}

/** Pull the first well-formed JSON object out of a possibly-chatty response. */
function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Curate a watch's new candidate dogs via the Managed Agent: returns the subset
 * worth alerting on, each with a warm, grounded headline + blurb. Returns null
 * on any failure (disabled, no key, beta unavailable, parse error) so the caller
 * falls back to the deterministic alert. Order/ids are validated against the
 * input, so a hallucinated id can never produce a bogus alert.
 */
export async function curateWatchAlerts(
  watchQuery: string,
  candidates: SearchMatch[]
): Promise<CuratedAlert[] | null> {
  if (!hasManagedAgent() || candidates.length === 0) return null;

  const validIds = new Set(candidates.map((c) => c.dog.id));
  const blocks = candidates.map(candidateBlock).join("\n\n");
  const prompt = `Watch request: "${watchQuery}"\n\nNew candidate dogs (${candidates.length}):\n\n${blocks}`;

  try {
    const client = getAnthropic() as unknown as MaBetaClient;
    const raw = await runCuratorTurn(client, prompt);
    const parsed = extractJson(raw) as { alerts?: unknown } | null;
    const alerts = Array.isArray(parsed?.alerts) ? parsed!.alerts : null;
    if (!alerts) return null;

    const out: CuratedAlert[] = [];
    for (const a of alerts) {
      const o = a as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : null;
      if (!id || !validIds.has(id)) continue; // never trust a hallucinated id
      const headline = typeof o.headline === "string" ? o.headline.trim() : "";
      const blurb = typeof o.blurb === "string" ? o.blurb.trim() : "";
      if (!headline && !blurb) continue;
      out.push({ id, headline: headline || "New match on your watch", blurb });
    }
    return out;
  } catch {
    return null; // any MA failure → deterministic fallback upstream
  }
}
