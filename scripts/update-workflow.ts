/**
 * Update TaskRouter Workflow
 * 
 * Removes the problematic skip_if conditions
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/update-workflow.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function updateWorkflow() {
  // Get current queue SIDs
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();
  
  const salesQueue = queues.find(q => q.friendlyName === 'Sales Queue');
  const voicemailQueue = queues.find(q => q.friendlyName === 'Voicemail');
  
  if (!salesQueue || !voicemailQueue) {
    throw new Error('Required queues not found');
  }

  // Restored workflow config with skip_if (original working version)
  const workflowConfig = {
    task_routing: {
      filters: [
        {
          filter_friendly_name: 'Sales',
          expression: '1==1',
          targets: [
            {
              queue: salesQueue.sid,
              timeout: 20,
              skip_if: 'workers.available == 0',
            },
            {
              queue: salesQueue.sid,
              timeout: 20,
              skip_if: 'workers.available == 0',
            },
            {
              queue: voicemailQueue.sid, // Fallback to voicemail
            },
          ],
        },
      ],
      default_filter: {
        queue: voicemailQueue.sid,
      },
    },
  };

  console.log('Updating workflow...');
  console.log('New config:', JSON.stringify(workflowConfig, null, 2));

  await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .update({
      configuration: JSON.stringify(workflowConfig),
    });

  console.log('✅ Workflow updated successfully');
}

updateWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
