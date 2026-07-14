/**
 * Re-enable (unpause) the paused "Scout Overnight Runner" Managed Agents
 * deployment, then trigger a catch-up run right now so it resumes harvesting
 * immediately instead of waiting for the next 2:15am Pacific cron.
 *
 * Pausing a scheduled deployment (from the Anthropic Console or the API)
 * suppresses its cron triggers while leaving the agent, environment, vault,
 * and schedule untouched — the inverse of `client.beta.deployments.pause`.
 * Unpausing resumes the schedule from the NEXT occurrence; nights missed while
 * paused are not backfilled. So this script also fires one manual run by
 * default to harvest the gap now (a manual run is allowed even while paused,
 * which is what `--run-only` leans on to force a harvest without touching the
 * pause state).
 *
 *   npx tsx scripts/resume-deployment.ts [deployment_id]
 *
 * The deployment id comes from the argument, else SCOUT_DEPLOYMENT_ID (the id
 * scripts/setup-overnight-agent.ts prints on its first run). Flags:
 *   --no-run     unpause only; skip the immediate catch-up run
 *   --run-only   trigger a run without unpausing (deployment already active)
 */
import { parseArgs } from "node:util";
import { getAnthropic } from "@/lib/anthropic";

interface StreamEvent {
  type: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: { type: string };
}

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "no-run": { type: "boolean", default: false },
    "run-only": { type: "boolean", default: false },
  },
});

const deploymentId = positionals[0] ?? process.env.SCOUT_DEPLOYMENT_ID;

/** Stream a triggered run's session events to completion (same shape as run-deployment.ts). */
async function streamRun(client: ReturnType<typeof getAnthropic>, sessionId: string) {
  const stream = await client.beta.sessions.events.stream(sessionId);
  for await (const event of stream as AsyncIterable<StreamEvent>) {
    if (event.type === "agent.message") {
      for (const block of event.content ?? []) {
        if (block.type === "text") process.stdout.write(block.text ?? "");
      }
    } else if (event.type === "session.error") {
      console.log("\n[session.error]", JSON.stringify(event));
    } else if (event.type === "session.status_idle") {
      console.log(`\n[idle: ${event.stop_reason?.type}]`);
      if (event.stop_reason?.type !== "requires_action") break;
    } else if (event.type === "session.status_terminated") {
      console.log("\n[terminated]");
      break;
    }
  }
}

async function main() {
  if (!deploymentId) {
    console.error(
      "Usage: npx tsx scripts/resume-deployment.ts [deployment_id]\n" +
        "Pass the deployment id as an argument or via SCOUT_DEPLOYMENT_ID " +
        "(scout:setup-overnight-agent prints it as SCOUT_DEPLOYMENT_ID=...)."
    );
    process.exit(1);
  }
  if (flags["no-run"] && flags["run-only"]) {
    console.error("Choose at most one of --no-run / --run-only.");
    process.exit(1);
  }

  const client = getAnthropic();

  // 1. Current state — so a no-op (already active) is obvious, not silent.
  let deployment = await client.beta.deployments.retrieve(deploymentId);
  console.log(
    `Deployment ${deployment.id} — status: ${deployment.status}` +
      (deployment.paused_reason ? ` (paused reason: ${deployment.paused_reason.type})` : "")
  );

  // 2. Re-enable the schedule, unless the caller only wants a manual run.
  if (flags["run-only"]) {
    console.log("--run-only: leaving pause state unchanged.");
  } else if (deployment.status === "paused") {
    deployment = await client.beta.deployments.unpause(deploymentId);
    console.log(`Unpaused → status: ${deployment.status}`);
  } else {
    console.log("Already active — nothing to unpause.");
  }

  // 3. Catch-up run now (unpause doesn't backfill nights missed while paused).
  if (!flags["no-run"]) {
    console.log("\nTriggering a catch-up run…");
    const run = await client.beta.deployments.run(deploymentId);
    if (run.error) {
      console.error(`Run ${run.id} failed to start a session: ${run.error.type} — ${run.error.message}`);
      process.exitCode = 1;
    } else if (run.session_id) {
      console.log(`Run ${run.id} → session ${run.session_id}\n`);
      await streamRun(client, run.session_id);
    } else {
      console.log(`Run ${run.id} created (no session id returned).`);
    }
  }

  // 4. Where things stand.
  console.log("\n── done ──");
  console.log(`Deployment ${deployment.id} is now ${deployment.status}.`);
  console.log(`Next scheduled runs: ${deployment.schedule?.upcoming_runs_at?.join(", ") ?? "n/a"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
