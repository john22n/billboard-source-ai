/**
 * Update TaskRouter Workflow
 *
 * Updates the workflow configuration to match current routing logic.
 * Matches setup from setup-taskrouter.ts
 *
 * Run with: npx dotenv -e .env.prod -- tsx scripts/update-workflow.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://billboard-source.vercel.app';

const MAIN_ROUTING_NUMBER = '+18338547126';

const DIRECT_NUMBERS = [
  '+12625876034',
  '+14177390805',
  '+15157383613',
  '+12237582821',
  '+15642342093',
  '+15418335744',
  '+13163953070',
  '+19783916647',
  '+17654396669',
  '+17123773679',
];

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function updateWorkflow() {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 UPDATING TASKROUTER WORKFLOW');
  console.log('═══════════════════════════════════════════');

  // Get current queue SIDs
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();

  const mainQueue = queues.find(q => q.friendlyName === 'Main Random Queue');
  const voicemailQueue = queues.find(q => q.friendlyName === 'Voicemail');

  if (!mainQueue || !voicemailQueue) {
    throw new Error('Required queues not found (Main Random Queue, Voicemail)');
  }

  // Build direct queue mapping
  const directQueues: Record<string, string> = {};
  for (const num of DIRECT_NUMBERS) {
    const queue = queues.find(q => q.friendlyName === `Direct ${num}`);
    if (queue) {
      directQueues[num] = queue.sid;
    } else {
      console.warn(`⚠️ Direct queue not found for ${num}`);
    }
  }

  // Workflow config matching setup-taskrouter.ts
  const workflowConfig = {
    task_routing: {
      filters: [
        // Direct numbers
        ...DIRECT_NUMBERS.filter(num => directQueues[num]).map(num => ({
          filter_friendly_name: `Direct ${num}`,
          expression: `callTo == "${num}"`,
          targets: [
            { queue: directQueues[num], timeout: 20 },
            { queue: voicemailQueue.sid, timeout: 120 },
          ],
        })),
        // Main number
        {
          filter_friendly_name: 'Main Number',
          expression: `callTo == "${MAIN_ROUTING_NUMBER}"`,
          targets: [
            { queue: mainQueue.sid, timeout: 20 },
            { queue: mainQueue.sid, timeout: 20 },
            { queue: voicemailQueue.sid, timeout: 120 },
          ],
        },
      ],
      default_filter: { queue: voicemailQueue.sid },
    },
  };

  console.log('Updating workflow...');
  console.log('Filters:', workflowConfig.task_routing.filters.length);

  await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .update({
      configuration: JSON.stringify(workflowConfig),
      assignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
      fallbackAssignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
      taskReservationTimeout: 120,
    });

  console.log('✅ Workflow updated successfully');
  console.log('═══════════════════════════════════════════');
}

updateWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
