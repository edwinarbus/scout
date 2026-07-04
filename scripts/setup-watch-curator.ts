/**
 * ONE-TIME SETUP for the "Scout Watch Curator" Managed Agent — pins its
 * agent + environment ids via env vars instead of the local-file cache
 * src/lib/managedAgent.ts falls back to for local dev. That local-file cache
 * can't work in production: a Vercel function's filesystem is read-only
 * outside /tmp, so every invocation would otherwise silently re-provision
 * (and fail to persist) a fresh agent, always falling back to the
 * deterministic ranking.
 *
 * Run once:
 *   npx tsx scripts/setup-watch-curator.ts
 *
 * Then set the two printed ids as Vercel env vars:
 *   vercel env add SCOUT_CURATOR_AGENT_ID production
 *   vercel env add SCOUT_CURATOR_ENV_ID production
 *
 * Re-running with SCOUT_CURATOR_AGENT_ID / SCOUT_CURATOR_ENV_ID already set
 * (e.g. after changing SCOUT_MANAGED_AGENT_MODEL) updates the existing agent
 * in place — a new version — instead of creating a duplicate.
 */
import { getAnthropic } from "@/lib/anthropic";
import { MODEL, CURATOR_PROMPT } from "@/lib/managedAgent";

async function main() {
  const client = getAnthropic();

  let environmentId = process.env.SCOUT_CURATOR_ENV_ID;
  if (!environmentId) {
    const env = await client.beta.environments.create({
      name: "scout-watch-curator-env",
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    environmentId = env.id;
    console.log(`Created environment ${environmentId}`);
  } else {
    console.log(`Reusing environment ${environmentId}`);
  }

  const agentParams = {
    name: "Scout Watch Curator",
    model: MODEL,
    system: CURATOR_PROMPT,
    // Full toolset attached so per-dog web research can be enabled later; the
    // prompt instructs the curator not to use tools for this task.
    tools: [{ type: "agent_toolset_20260401" as const }],
  };

  let agentId = process.env.SCOUT_CURATOR_AGENT_ID;
  if (!agentId) {
    const agent = await client.beta.agents.create(agentParams);
    agentId = agent.id;
    console.log(`Created agent ${agentId} (version ${agent.version}, model ${MODEL})`);
  } else {
    const existing = await client.beta.agents.retrieve(agentId);
    if (existing.model.id !== MODEL) {
      const updated = await client.beta.agents.update(agentId, {
        version: existing.version,
        model: MODEL,
      });
      console.log(`Updated agent ${agentId}: ${existing.model.id} → ${MODEL} (version ${updated.version})`);
    } else {
      console.log(`Reusing agent ${agentId} (already ${MODEL})`);
    }
  }

  console.log("\n── done ──");
  console.log("Set these as Vercel env vars (production):");
  console.log(`  SCOUT_CURATOR_AGENT_ID=${agentId}`);
  console.log(`  SCOUT_CURATOR_ENV_ID=${environmentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
