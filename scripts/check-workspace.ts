/**
 * Check TaskRouter Workspace Configuration
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/check-workspace.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function checkWorkspace() {
  console.log('═══════════════════════════════════════════');
  console.log('📋 WORKSPACE CONFIGURATION');
  console.log('═══════════════════════════════════════════');
  
  const workspace = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .fetch();
  
  console.log('Name:', workspace.friendlyName);
  console.log('SID:', workspace.sid);
  console.log('Event Callback URL:', workspace.eventCallbackUrl);
  console.log('Events Filter:', workspace.eventsFilter);
  console.log('Default Activity SID:', workspace.defaultActivitySid);
  console.log('Timeout Activity SID:', workspace.timeoutActivitySid);
}

checkWorkspace()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });

async function checkQueueWorkers() {
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 SALES QUEUE WORKERS');
  console.log('═══════════════════════════════════════════');
  
  // Get the Sales Queue SID
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();
  
  const salesQueue = queues.find(q => q.friendlyName === 'Sales Queue');
  if (!salesQueue) {
    console.log('❌ Sales Queue not found');
    return;
  }
  
  console.log(`Sales Queue SID: ${salesQueue.sid}`);
  console.log(`Target Workers Expression: ${salesQueue.targetWorkers}`);
  
  // List all workers and check which would match the queue
  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();
  
  console.log(`\nTotal workers: ${workers.length}`);
  console.log('Workers in Available activity:');
  
  for (const worker of workers) {
    if (worker.available) {
      const attrs = JSON.parse(worker.attributes || '{}');
      console.log(`  - ${worker.friendlyName} (${attrs.email})`);
      console.log(`    Activity: ${worker.activityName}`);
      console.log(`    SID: ${worker.sid}`);
    }
  }
}

checkQueueWorkers().catch(console.error);
