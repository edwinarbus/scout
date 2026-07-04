/**
 * ONE-TIME SETUP for the "Scout Overnight Runner" — a Claude Managed Agents
 * scheduled deployment that triggers Scout's overnight pipeline every night,
 * hosted entirely on Anthropic's infrastructure. No cron machine, server, or
 * GitHub Actions runner of your own.
 *
 * Deliberately minimal: the agent's ONLY job is to hit one URL on a cron.
 * All the real work (scrape, watch-check, curate, text) already runs on
 * Vercel via POST /api/cron/overnight, which reuses the app's existing
 * ANTHROPIC_API_KEY / TURSO_* / SCOUT_TWILIO_* — those never need to be
 * duplicated here. The only new secret is CRON_SECRET, which protects that
 * endpoint from being called by anyone else.
 *
 * Run once:
 *   npx tsx scripts/setup-overnight-agent.ts
 *
 * Requires in your shell environment:
 *   ANTHROPIC_API_KEY   - to create the agent/environment/vault/deployment
 *   CRON_SECRET         - must be the SAME value already set as the Vercel
 *                          env var of the same name (`vercel env add CRON_SECRET`)
 *   SCOUT_URL           - optional; defaults to https://scoutthe.dog
 *
 * Re-running is safe: pass SCOUT_AGENT_ID / SCOUT_ENV_ID / SCOUT_VAULT_ID
 * (printed by a previous run) to reuse those instead of creating new ones.
 */
import { getAnthropic } from "@/lib/anthropic";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const SCOUT_URL = process.env.SCOUT_URL ?? "https://scoutthe.dog";
const SCOUT_HOST = new URL(SCOUT_URL).host;

const KICKOFF = `Run this exact command, then report its output verbatim (or the curl error if it fails). Do not modify anything, do not retry more than once.

curl -sf -X POST "${SCOUT_URL}/api/cron/overnight" -H "Authorization: Bearer $CRON_SECRET"`;

async function main() {
  requireEnv("ANTHROPIC_API_KEY");
  const cronSecret = requireEnv("CRON_SECRET");
  const client = getAnthropic();

  // 1. Environment — cloud, egress limited to Scout's own domain. The agent
  //    never touches anything else, so there's no reason to allow more.
  let environmentId = process.env.SCOUT_ENV_ID;
  if (!environmentId) {
    const env = await client.beta.environments.create({
      name: "scout-overnight-runner-env",
      config: {
        type: "cloud",
        networking: { type: "limited", allowed_hosts: [SCOUT_HOST] },
      },
    });
    environmentId = env.id;
    console.log(`Created environment ${environmentId}`);
  } else {
    console.log(`Reusing environment ${environmentId}`);
  }

  // 2. Agent — bash only. It runs one curl command; nothing else.
  let agentId = process.env.SCOUT_AGENT_ID;
  if (!agentId) {
    const agent = await client.beta.agents.create({
      name: "Scout Overnight Runner",
      model: "claude-opus-4-8",
      system:
        "You trigger Scout's overnight cron endpoint via curl and report its response faithfully. You never invent output, never retry more than once, never do anything else.",
      tools: [
        {
          type: "agent_toolset_20260401",
          default_config: { enabled: false },
          configs: [{ name: "bash", enabled: true }],
        },
      ],
    });
    agentId = agent.id;
    console.log(`Created agent ${agentId} (version ${agent.version})`);
  } else {
    console.log(`Reusing agent ${agentId}`);
  }

  // 3. Vault — a single CRON_SECRET credential, substituted at egress and
  //    scoped to Scout's own host only.
  let vaultId = process.env.SCOUT_VAULT_ID;
  if (!vaultId) {
    const vault = await client.beta.vaults.create({ display_name: "scout-overnight-secret" });
    vaultId = vault.id;
    await client.beta.vaults.credentials.create(vaultId, {
      auth: {
        type: "environment_variable",
        secret_name: "CRON_SECRET",
        secret_value: cronSecret,
        networking: { type: "limited", allowed_hosts: [SCOUT_HOST] },
      },
      display_name: "CRON_SECRET",
    });
    console.log(`Created vault ${vaultId} with CRON_SECRET`);
  } else {
    console.log(`Reusing vault ${vaultId}`);
  }

  // 4. Scheduled deployment — nightly at 2:15am Pacific (matches the CLI's
  //    own suggested cron time).
  const deployment = await client.beta.deployments.create({
    name: "Scout overnight trigger",
    agent: agentId,
    environment_id: environmentId,
    vault_ids: [vaultId],
    initial_events: [{ type: "user.message", content: [{ type: "text", text: KICKOFF }] }],
    schedule: { type: "cron", expression: "15 2 * * *", timezone: "America/Los_Angeles" },
  });

  console.log("\n── done ──");
  console.log(`Deployment: ${deployment.id} (${deployment.status})`);
  console.log(`Next runs: ${deployment.schedule?.upcoming_runs_at?.join(", ") ?? "n/a"}`);
  console.log("\nSave these for future re-runs (do NOT commit them anywhere):");
  console.log(`  SCOUT_AGENT_ID=${agentId}`);
  console.log(`  SCOUT_ENV_ID=${environmentId}`);
  console.log(`  SCOUT_VAULT_ID=${vaultId}`);
  console.log(`  SCOUT_DEPLOYMENT_ID=${deployment.id}`);
  console.log(
    `\nTest it right now instead of waiting for 2:15am:\n` +
      `  await client.beta.deployments.run("${deployment.id}")`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
