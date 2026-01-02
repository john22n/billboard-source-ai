/**
 * Debug TaskRouter Configuration
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/debug-taskrouter.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function debug() {
  // Check workflow assignment callback
  console.log('═══════════════════════════════════════════');
  console.log('📋 WORKFLOW ASSIGNMENT CALLBACK');
  console.log('═══════════════════════════════════════════');
  
  const workflow = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .fetch();
  
  console.log('Assignment Callback URL:', workflow.assignmentCallbackUrl);
  console.log('Task Reservation Timeout:', workflow.taskReservationTimeout);

  // Check available workers in Sales Queue
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 AVAILABLE WORKERS');
  console.log('═══════════════════════════════════════════');
  
  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list({ available: 'true' });
  
  console.log(`Available workers: ${workers.length}`);
  for (const worker of workers) {
    const attrs = JSON.parse(worker.attributes || '{}');
    console.log(`  - ${worker.friendlyName}`);
    console.log(`    Email: ${attrs.email}`);
    console.log(`    Contact URI: ${attrs.contact_uri}`);
    console.log(`    Activity: ${worker.activityName} (${worker.activitySid})`);
  }
  
  // Check Activities
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 ACTIVITIES');
  console.log('═══════════════════════════════════════════');
  
  const activities = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .activities.list();
  
  for (const activity of activities) {
    console.log(`  ${activity.friendlyName}: available=${activity.available} (${activity.sid})`);
  }
  
  // Check recent events
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 RECENT EVENTS (last 10)');
  console.log('═══════════════════════════════════════════');
  
  const events = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .events.list({ limit: 10 });
  
  for (const event of events) {
    console.log(`  ${event.eventType} - ${event.eventDateMs}`);
    console.log(`    Data: ${JSON.stringify(event.eventData).substring(0, 100)}...`);
  }
}

debug()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
