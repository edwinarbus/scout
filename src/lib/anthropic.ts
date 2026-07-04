import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnvFile } from "dotenv";

/**
 * Claude API access for Scout's optional AI layer (phase 3).
 *
 * Scope + faithfulness rules (mirror the rest of the project):
 *  - AI is additive. Vision output and NL-search parsing are clearly labeled
 *    model inference; they never overwrite shelter-provided facts.
 *  - Original shelter listings remain the source of truth.
 *  - The AI layer is entirely optional: with no API credential the app still
 *    runs (map, filters, deterministic matching); only /api/search and the
 *    enrichment CLI need a key.
 *
 * Model choice (both overridable via env):
 *  - Vision enrichment runs over thousands of images as a one-time-ish batch,
 *    so it defaults to Haiku 4.5 — fast and cheap for perceptual tagging.
 *    Set SCOUT_VISION_MODEL=claude-opus-4-8 to upgrade.
 *  - NL search is one low-volume call per query where reasoning quality
 *    matters, so it defaults to Sonnet 5 (near-Opus query understanding at
 *    lower cost/latency for an interactive box). Set SCOUT_SEARCH_MODEL to change.
 */

// `next dev`/`next start` auto-load .env.local, but the CLI scripts (enrich,
// refresh) run as plain `tsx` processes and don't get that for free — load it
// here, once, at the single module every credential check goes through.
// dotenv never overrides a variable that's already set, so this is a no-op
// when Next.js (or the shell) already populated process.env.
loadEnvFile({ path: ".env.local" });

export const VISION_MODEL = process.env.SCOUT_VISION_MODEL ?? "claude-haiku-4-5";
export const SEARCH_MODEL = process.env.SCOUT_SEARCH_MODEL ?? "claude-sonnet-5";

let client: Anthropic | null = null;

export class MissingCredentialError extends Error {
  constructor() {
    super(
      "No Anthropic credential found. Set ANTHROPIC_API_KEY (or run `ant auth login`) before using Scout's AI features."
    );
    this.name = "MissingCredentialError";
  }
}

/** True if an API credential is present in the environment. */
export function hasAnthropicCredential(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Shared Anthropic client. The zero-arg constructor resolves credentials from
 * the environment (ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN → `ant` profile),
 * so a profile set up via `ant auth login` works even with no env var. We only
 * hard-fail early when neither an env var nor (best-effort) a profile is set.
 */
export function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Parse a Claude structured-output response into a typed object.
 * With output_config.format the model returns a single JSON text block; this
 * concatenates text blocks and JSON-parses them.
 */
export function parseStructured<T>(message: Anthropic.Message): T {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) {
    throw new Error("Claude returned no text content to parse");
  }
  return JSON.parse(text) as T;
}

/** A JSON Schema object accepted by output_config.format. */
export type JsonSchema = Record<string, unknown>;

/**
 * A structured-output request. `output_config.format` constrains the response
 * to valid JSON matching `schema` (supported on Haiku 4.5, Opus 4.8, Sonnet 5,
 * Fable 5). We pass it through the SDK's create() as a typed-through field.
 */
export interface StructuredRequest {
  model: string;
  maxTokens: number;
  system?: string;
  content: Anthropic.ContentBlockParam[];
  schema: JsonSchema;
}

export async function createStructured<T>(req: StructuredRequest): Promise<T> {
  const anthropic = getAnthropic();
  const message = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    // Prompt caching: the system prompt is the big CONSTANT prefix every query
    // shares — identical across the fixed suggested prompts and every re-rank
    // chunk — so we mark it ephemeral. Repeat calls (a suggestion clicked again,
    // the 8 concurrent re-rank chunks) read the cached prefix instead of
    // re-billing/re-processing it. No-op if the prefix is under the model's
    // cache minimum; harmless either way.
    ...(req.system
      ? { system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] }
      : {}),
    messages: [{ role: "user", content: req.content }],
    // Structured outputs: constrain the response to the given JSON schema.
    output_config: { format: { type: "json_schema", schema: req.schema } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  return parseStructured<T>(message);
}
