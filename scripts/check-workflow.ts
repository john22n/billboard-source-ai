/**
 * Check TaskRouter Workflow Configuration
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/check-workflow.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function checkWorkflow() {
  console.log('═══════════════════════════════════════════');
  console.log('📋 WORKFLOW CONFIGURATION');
  console.log('═══════════════════════════════════════════');
  
  const workflow = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .fetch();
  
  console.log('Name:', workflow.friendlyName);
  console.log('Assignment Callback URL:', workflow.assignmentCallbackUrl);
  console.log('Fallback Assignment Callback URL:', workflow.fallbackAssignmentCallbackUrl);
  console.log('Task Reservation Timeout:', workflow.taskReservationTimeout);
  console.log('\nConfiguration:');
  console.log(JSON.stringify(JSON.parse(workflow.configuration), null, 2));
  
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 TASK QUEUES');
  console.log('═══════════════════════════════════════════');
  
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();
  
  for (const queue of queues) {
    console.log(`\n${queue.friendlyName} (${queue.sid})`);
    console.log(`  Target Workers: ${queue.targetWorkers}`);
    console.log(`  Reservation Activity SID: ${queue.reservationActivitySid}`);
    console.log(`  Assignment Activity SID: ${queue.assignmentActivitySid}`);
    
    // Check real-time stats for eligible workers
    const realtime = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .taskQueues(queue.sid)
      .realTimeStatistics()
      .fetch();
    
    console.log(`  Eligible Workers: ${realtime.totalEligibleWorkers}`);
    console.log(`  Available Workers: ${realtime.totalAvailableWorkers}`);
  }
}

checkWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
