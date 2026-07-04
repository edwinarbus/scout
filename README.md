# Scout

A personal, non-commercial California dog-adoption matcher. It scrapes real listings from a
dozen-plus CA shelter and rescue systems onto one schema, then layers Claude on top of the raw
data — natural-language search, photo understanding, and a nightly Managed Agent that curates
and texts you new matches.

The original shelter listing is always the source of truth. Nothing here republishes a
listing as its own, contacts a shelter automatically, or claims a dog is unavailable without
saying so plainly — every card links back to the shelter and reminds you to confirm before
acting.

## What it does

**Natural-language + voice search (Claude Sonnet 5).** One search box. Type or speak "scruffy
small dog, good in an apartment, under 25 lb, been waiting a while, near Oakland" and Claude
turns it into a ranked shortlist — parsing the sentence into structured criteria, then
re-scoring the shortlist with shelter facts, bio text, photo reads, and breed-typical
knowledge no structured field captures ("cattle-dog mixes need real exercise"). The loading
state IS the matching: real candidate cards fly in and sift past the query text as each stage
returns, then morph into the final scored grid via the View Transitions API — never a spinner
in front of half-finished results. Voice input uses the browser's own Web Speech API, no key
needed.

**Photo vision (Claude Haiku 4.5).** Reads one photo per dog into searchable visual features —
coat length/texture ("scruffy," "fluffy"), apparent size, colors, a one-line description, a
photo-quality flag — so search can match what a dog *looks like*, not just its shelter-listed
fields. Cached by photo hash; a re-run only touches dogs whose photo actually changed.

**The Scout Watch Curator — a managed agent (Claude Managed Agents).** Save a search as a
standing watch and every night Scout pulls fresh listings across every source, re-evaluates
every watch, and hands genuinely new matches to a persisted, versioned Managed Agent that
judges which are actually worth a text and writes the alert copy — grounded only in the facts
it's given, never inventing a trait. With Twilio configured, each curated match is texted via
the Twilio REST API; a per-watch ledger means you're never re-pinged about a dog you've seen.

**Everything else you'd expect:** cross-source duplicate detection (flagged, never
auto-merged), a cautious available → missing → likely-unavailable freshness ladder, photo
hygiene (placeholder "image coming soon" graphics and broken images are pruned — no photo, no
dog), and a source-health dashboard (robots.txt compliance, backfill status, per-source data
completeness, confidence scoring).

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript + Tailwind CSS v4
- **[Turso](https://turso.tech)** (libSQL, SQLite-compatible) + **Drizzle ORM** — a serverless
  function's filesystem is read-only outside `/tmp`, so the deployed app talks to a real
  remote database rather than a local file; the same schema/queries fall back to a local
  SQLite file with no Turso credential configured (`@libsql/client` supports both)
- **MapLibre GL** with a free CARTO basemap, masked to California only
- **cheerio** for HTML parsing behind a polite, per-source rate-limited fetch client
- **sharp** for photo downscaling ahead of vision calls
- **`@anthropic-ai/sdk`** — every Claude feature below
- **Vitest** for tests (fixture-recorded, no live network), **tsx** for CLI scripts

## Claude API surface

Claude shows up in three shapes across the app, each picked for what the task needs:

| Feature | Model | API surface |
|---|---|---|
| Natural-language search | Sonnet 5 | `messages.create` with **Structured Outputs** (`output_config.format: json_schema`) for the parse stage; the same pattern repeated across the re-rank stage's parallel chunked calls (`Promise.allSettled`, 5-dog chunks — output tokens generate serially *within* a call, so 8 small concurrent calls finish in the time of one); **prompt caching** (`cache_control: ephemeral`) on the shared system prompt across chunks |
| Photo vision | Haiku 4.5 | Multimodal `messages.create` — one downscaled (≤512px) base64 JPEG `image` content block per dog — with Structured Outputs, cached by photo hash so unchanged photos are never re-sent |
| Scout Watch Curator | Opus 4.8 | **Managed Agents** — a persisted `Agent` (`beta.agents.create` + `beta.environments.create`), created once and reused, run per watch-check via `beta.sessions.create` + streamed `beta.sessions.events`; the `agent_toolset_20260401` toolset is attached for future per-dog web research |

Structured Outputs means a malformed parse response can't happen structurally; the re-rank
stage's chunking means one failed chunk only drops *its* dogs back to deterministic order,
never the whole search; and the curator's failure path (no beta access, a bad response) falls
back cleanly to the deterministic alert ranking — a rough night for the API is never a rough
night for the alert.

## Quick start

```bash
npm install
npm run seed                 # upsert the CA source registry
npm run backfill -- --all    # full-inventory initialization (slow, polite)
npm run dev                  # → http://localhost:3000
```

Real shelter data only — there's no mock/demo mode (the mock adapter exists solely for tests).
Everything below is additive on top of that base pipeline.

```bash
npm run enrich -- --all      # photo vision (Haiku 4.5), cached
npm run ingest:all           # scrape every initialized source
npm run scout:overnight      # ingest + watch check + Managed Agent curation + SMS
```

In production, `ANTHROPIC_API_KEY` is set as a Vercel environment variable, so search, vision,
and the overnight curator are always on.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Search, vision, overnight curator | Set as a Vercel env var in production |
| `SCOUT_SEARCH_MODEL` | — | Override the search model (default `claude-sonnet-5`) |
| `SCOUT_VISION_MODEL` | — | Override the vision model (default `claude-haiku-4-5`) |
| `SCOUT_MANAGED_AGENT_MODEL` | — | Override the curator model (default `claude-opus-4-8`) |
| `SCOUT_MANAGED_AGENT=0` | — | Opt out of the curator specifically; search/vision unaffected |
| `SCOUT_TWILIO_ACCOUNT_SID`, `SCOUT_TWILIO_AUTH_TOKEN`, `SCOUT_TWILIO_FROM` | SMS alerts | Twilio credentials — each is its own full env var name; don't abbreviate |
| `SCOUT_SMS_TO` | SMS alerts | Destination phone number |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Deployed use | Provisioned via the Vercel Marketplace Turso integration; no Turso credential falls back to a local SQLite file |

## Project layout

```
src/
  adapters/     one file per shelter system (LA Animal Services, San Diego Humane,
                24Petconnect, ShelterLuv, Adopets, ShelterBuddy, Oakland, Muttville, …)
  ingest/       runner (daily + backfill, dedupe, gating), enrich (vision batch),
                overnight (watch eval + curation + SMS), confidence scoring
  lib/          anthropic (Claude client), aiSearch (parse + re-rank), managedAgent,
                match, normalize, lifecycle, canonical, geo, photo, sms, dogView
  sources/      registry.ts — CA source configs, politeness, permissions, tenant configs
  db/           Drizzle schema + SQL migrations (libSQL/Turso, local-file fallback)
  app/          matcher + map UI (/), health dashboard (/sources), API routes
scripts/        CLI entry points (seed, verify, backfill, ingest, enrich, overnight, …)
```

## Scope & constraints

This is a single-person tool, not a product: no accounts, no multi-tenant data, no public
API. Sources are fetched politely and at low frequency, respecting `robots.txt`; two sources
that 403 non-browser clients use browser-profile headers as a recorded operator decision.
Length-of-stay and some structured fields are only as good as what each shelter publishes —
missing data stays null, never guessed. Cross-source duplicate flags are heuristic and never
auto-merge. Claude's photo reads and query parsing are always shown as labeled impressions,
never verified facts — and Scout never sends anything to a shelter on your behalf.
