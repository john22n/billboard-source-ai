/**
 * Setup Voicemail TaskRouter Resources
 *
 * Creates:
 * - Voicemail Queue
 * - Voicemail Workflow
 *
 * Run with:
 * npx dotenv -e .env.dev -- tsx scripts/setup-voicemail.ts
 */

import twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID) {
  console.error("❌ Missing required environment variables");
  console.error("Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TASKROUTER_WORKSPACE_SID");
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function setupVoicemail() {
  console.log("═══════════════════════════════════════════");
  console.log("📩 SETTING UP VOICEMAIL TASKROUTER");
  console.log("═══════════════════════════════════════════\n");

  /* ────────────────────────────────
   * 1. Create Voicemail Queue
   * ──────────────────────────────── */
  console.log("Creating Voicemail Queue…");

  const queue = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.create({
      friendlyName: "Voicemail Queue",
      targetWorkers: "1==1",
    });

  console.log("  ✅ Voicemail Queue created");
  console.log("  Queue SID:", queue.sid, "\n");

  /* ────────────────────────────────
   * 2. Create Voicemail Workflow
   * ──────────────────────────────── */
  console.log("Creating Voicemail Workflow…");

  const workflowConfig = {
    task_routing: {
      filters: [
        {
          expression: "type == 'voicemail'",
          targets: [
            {
              queue: queue.sid,
            },
          ],
        },
      ],
      default_filter: {
        queue: queue.sid,
      },
    },
  };

  const workflow = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows.create({
      friendlyName: "Voicemail Workflow",
      configuration: JSON.stringify(workflowConfig),
    });

  console.log("  ✅ Voicemail Workflow created");
  console.log("  Workflow SID:", workflow.sid, "\n");

  console.log("═══════════════════════════════════════════");
  console.log("🎯 SAVE THESE ENV VARS");
  console.log("═══════════════════════════════════════════");
  console.log(`VOICEMAIL_QUEUE_SID=${queue.sid}`);
  console.log(`VOICEMAIL_WORKFLOW_SID=${workflow.sid}`);
  console.log("═══════════════════════════════════════════");
}

setupVoicemail()
  .then(() => {
    console.log("\n🎉 Voicemail setup complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Voicemail setup failed:", err);
    process.exit(1);
  });

