/**
 * Manually trigger a Managed Agents scheduled deployment right now, and
 * stream the resulting session's events to completion — useful for testing
 * a deployment (e.g. the overnight trigger) without waiting for its cron.
 *
 *   npx tsx scripts/run-deployment.ts <deployment_id>
 */
import { getAnthropic } from "@/lib/anthropic";

interface StreamEvent {
  type: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: { type: string };
}

async function main() {
  const deploymentId = process.argv[2];
  if (!deploymentId) {
    console.error("Usage: npx tsx scripts/run-deployment.ts <deployment_id>");
    process.exit(1);
  }

  const client = getAnthropic();
  console.log(`Triggering deployment ${deploymentId}...`);
  const run = await client.beta.deployments.run(deploymentId);
  console.log(`Run ${run.id} → session ${run.session_id ?? "(none — see error below)"}`);
  if (!run.session_id) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  const stream = await client.beta.sessions.events.stream(run.session_id);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
