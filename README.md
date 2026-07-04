# 🐕 Scout — a personal California dog-adoption matcher

Scout scrapes adoptable-dog listings from a dozen-plus California shelter and rescue
systems, normalizes and dedupes them into one schema, and lets you find your dog by
**describing it in plain language** ("scruffy small dog, good in an apartment, under 25 lb,
been waiting a while, near Oakland"). Claude turns that sentence into a ranked shortlist,
reading each dog's photo, bio, and shelter facts — and optionally watches the shelters
overnight and texts you when a new match shows up.

> **Personal, non-commercial, and honest by construction.** Scout is a private
> research/alerting tool, not a public adoption directory. Original shelter listings are
> always the source of truth: every dog links back to its posting, every card reminds you
> to confirm availability with the shelter, Claude's inferences are labeled as impressions
> (never as shelter facts), and Scout never contacts a shelter automatically.

---

## The Claude layer

Scout is built around the **[Claude API](https://platform.claude.com/docs)** via the
official [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript). It
leans on several distinct API capabilities — all optional: with no `ANTHROPIC_API_KEY` the
map, filters, and deterministic matching still work, and the AI features simply stay dark.

### Natural-language matching — `POST /api/search`

Typing (or **speaking**) a description runs a three-stage pipeline, staged so the UI can
show its work — criteria chips appear in ~1s, real dog cards start sifting immediately, and
the final scored grid morphs in via the View Transitions API.

1. **Parse** — one **Messages API** call turns free text into a typed `SearchCriteria`
   object (breed/size/age/sex/color, weight & length-of-stay bounds, place + radius, soft
   visual traits, bio keywords). Uses **Structured Outputs**
   (`output_config.format = { type: "json_schema", schema }`) so the response is guaranteed
   to match the schema — no brittle JSON-from-prose parsing. Only your query text is sent.
2. **Filter + shortlist** — deterministic, no API call: hard filters (unknown data never
   rejects — it's surfaced as "unverified"), then trait/keyword scoring against cached photo
   reads and bios. Works on its own if the API is unavailable.
3. **Re-rank** — the top 40 candidates go back to Claude as compact evidence lines and it
   scores fit 0–100, blending shelter facts, bio, photo read, **and breed-typical knowledge
   the data can't express** ("cattle-dog mixes need real exercise"). Every reason is tagged
   with its source; anything the data doesn't cover becomes an explicit `Unverified:` caveat
   rather than a claim.

**Claude API features in play here:**

- **Structured Outputs** on every call (parse + each re-rank chunk) for schema-valid JSON.
- **Prompt caching** — the large constant system prompt is sent with
  `cache_control: { type: "ephemeral" }`, so the eight concurrent re-rank chunks and repeated
  suggested-prompt clicks read the cached prefix instead of re-billing it.
- **Parallel chunked calls** — the 40-dog shortlist is split into 5-dog chunks fired
  concurrently with `Promise.allSettled`. Output tokens generate serially *within* a call, so
  eight small parallel calls finish in roughly the time of one (~10–20 s instead of ~90 s) at
  the same token cost. A failed chunk drops only its own dogs back to screened order.
- **Model routing** — interactive search defaults to **Claude Sonnet 5** (near-Opus
  understanding at interactive latency); override with `SCOUT_SEARCH_MODEL`.

### Vision enrichment — `npm run enrich`

A precomputed batch that reads **one photo per dog** with Claude's **multimodal Messages
API**: the primary image is downscaled to a ≤512 px JPEG and sent as a base64 `image`
content block, and **Structured Outputs** returns coat length/texture ("scruffy"/"fluffy"),
apparent size, colors, searchable tags, a one-line description, a photo-quality flag, and a
confidence. Reads land in a separate `dog_ai_enrichment` table, **cached by photo hash** so
re-runs only touch dogs whose photo changed. The UI shows a `✨ AI` chip and an "AI photo
read" panel, labeled as an unverified impression — and these tags are what NL search matches
"scruffy"/"fluffy"/etc. against.

- **Model routing** — defaults to **Claude Haiku 4.5** (fast/cheap for a thousands-of-images
  batch); set `SCOUT_VISION_MODEL=claude-opus-4-8` to upgrade.
- Runs as a batch of independent single calls — no agent loop — so it's a scheduled local
  job next to the SQLite DB, not a hosted agent (see below).

### Overnight curator — Claude Managed Agents (beta, optional)

The overnight scout's optional third layer (`SCOUT_MANAGED_AGENT=1`) sends each night's new
matches to a **[Claude Managed Agent](https://platform.claude.com/docs/en/managed-agents/overview)**
(`client.beta.agents.create` / `environments.create` / `sessions.create` + streamed
`sessions.events`) — a **persistent, versioned agent created once and reused** (its id is
cached in `data/managed-agent.json`, recreated only if the model or prompt changes). It
judges which matches are genuinely worth alerting on, from facts only. The full
`agent_toolset_20260401` toolset is attached (leaving room for future per-dog web research),
though the curator prompt tells it to reason from the provided text without tools. Any
failure falls back to the deterministic ranking. Defaults to **Claude Opus 4.8**
(`SCOUT_MANAGED_AGENT_MODEL`).

### Credentials & graceful degradation

`src/lib/anthropic.ts` is the single entry point. The SDK's zero-arg constructor resolves
credentials from the environment (`ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → an
`ant auth login` profile), and the file loads `.env.local` so the CLI scripts (`tsx`, which
doesn't get Next's env loading) see the key too. `hasAnthropicCredential()` gates every AI
path, so a missing key degrades cleanly instead of erroring.

---

## Voice input

The search box takes speech via the browser's built-in **Web Speech API** (Chrome, Safari)
— no key, no upload. Interim words stream into the box live; a pause (or a second mic tap)
auto-submits. Browsers without `SpeechRecognition` just don't show the mic.

## Overnight scout — standing watches + SMS

Run a search, tap **Watch this search**, and that natural-language query becomes a standing
watch. `npm run scout:overnight` (point cron/launchd at it) ingests fresh listings, re-runs
every watch through the same parse→filter pipeline, diffs against a per-watch "already
alerted" ledger, and — with Twilio configured — texts you each genuinely **new**, adoptable,
photographed match (via the Twilio REST API), never re-pinging a dog you've seen. Every
layer is optional and degrades gracefully. The header bell manages watches, shows whether
texts are on, and fires a test.

## Data pipeline

- **Sources** — one adapter per system, driven by a registry (`src/sources/registry.ts`)
  that records politeness settings, robots/permission findings, and operator overrides.
  Working families include LA Animal Services, LA County DACC, San Diego Humane,
  SF ACC / SF SPCA, Oakland AS, 24Petconnect (5 county tenants), Adopets (Long Beach,
  Front Street/Sacramento), ShelterLuv (Rocket Dog Rescue), Muttville, and Marin Humane.
  Adding a ShelterLuv/Adopets org is a one-line tenant config.
- **Dedupe** — within a source, every listing gets a stable `dedupeKey` (animal ID →
  URL hash); in-batch duplicates merge (richer record wins) before upserting, preserving
  `firstSeenAt` and user statuses. Across sources, canonical groups *flag* likely duplicates
  (shared photo / name+breed overlap) with a confidence score — never auto-merging.
- **Freshness lifecycle** — a deliberately cautious `available → missing_once →
  missing_multiple_runs → likely_unavailable` ladder. Only conclusive runs (complete
  pagination) can mark a dog missing; partial/failed runs freeze statuses and say so. Dogs
  are never deleted.
- **Photo hygiene** — placeholder "image coming soon" graphics (by URL pattern, redirect
  target, or exact pixel dimensions) and broken images are dropped both client-side and via
  `npm run scout:prune-photos`, so a placeholder never fronts a card. **No photo, no dog.**
- **Health & confidence** — every run records a full stats bundle and a rule-based
  confidence score (0–1). `/sources` surfaces per-source health, a data-completeness table,
  robots/permission badges, and the exact next debugging step for anything degraded.

## Quick start

```bash
npm install
npm run seed                 # upsert the CA source registry
npm run verify               # fixture-mode adapter checks (no network)
npm run backfill -- --all    # full-inventory initialization (slow, polite)
npm run dev                  # web UI at http://localhost:3000
```

Turn on the AI layer by adding a key to `.env.local` (gitignored):

```bash
ANTHROPIC_API_KEY=sk-ant-...          # enables NL search + vision enrichment
npm run enrich -- --all               # precompute photo reads (cached; safe to re-run)
```

**Daily driver:** `npm run refresh` ingests every initialized source, then — only if a key
is present — enriches new/changed photos. Schedule it:

```cron
0 7 * * *  cd ~/scout && ANTHROPIC_API_KEY=sk-ant-... npm run refresh >> data/refresh.log 2>&1
```

Optional env (all degrade to "off"): `SCOUT_SEARCH_MODEL`, `SCOUT_VISION_MODEL`,
`SCOUT_TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_FROM`, `SCOUT_SMS_TO`, `SCOUT_MANAGED_AGENT=1`
(+ `SCOUT_MANAGED_AGENT_MODEL`).

Other commands: `npm run ingest:all` (daily scrape), `npm run scout:overnight`,
`npm test`, `npm run typecheck`, `npm run lint`, `npm run db:studio`.

## Architecture

```
scripts/         seed · verify · backfill · ingest · enrich · refresh · overnight · prune-photos
src/sources/     registry.ts — CA sources, politeness, permissions, tenant configs
src/adapters/    one per system (+ __fixtures__/ recorded pages for tests)
src/ingest/      runner (daily + backfill, dedupe, gating) · enrich (vision) · overnight · confidence
src/lib/         anthropic (Claude client) · aiSearch (parse + re-rank) · managedAgent ·
                 match · normalize · lifecycle · canonical · geo · photo · sms · dogView
src/app/         matcher + map UI (/) · health dashboard (/sources) · API routes
src/db/          Drizzle schema + SQL migrations (SQLite; portable to Postgres/PostGIS)
```

**Stack:** Next.js 15 · React 19 · Tailwind v4 · MapLibre GL (free CARTO basemap) ·
SQLite (better-sqlite3 + Drizzle) · cheerio · sharp · Vitest · `@anthropic-ai/sdk`.

## Notes & limitations

- Claude's photo reads and query parsing are inference from limited input (one image; your
  words) — always shown as labeled impressions, never verified facts. Enrichment is only as
  fresh as the last `refresh`.
- Length-of-stay is only as good as the source's intake date; sources without one show none
  rather than a guess. Some feeds omit size/weight/color — missing stays null, never faked.
- Cross-source duplicate flags are heuristic; review before believing them.
- Two sources need browser-profile headers (403 to non-browser clients); this is recorded as
  an operator decision on the source row, and disabling the source removes it cleanly.

---

*Scout collects public adoption listings for personal use, links every dog back to its
original listing, and never automates contact with shelters. Verify everything with the
shelter before acting — dogs get adopted fast, and that's the good outcome.*
