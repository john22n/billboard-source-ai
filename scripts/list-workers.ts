/**
 * List TaskRouter Workers
 * 
 * Shows all workers in the TaskRouter workspace with their status and attributes.
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/list-workers.ts
 * Or for dev: npx dotenv -e .env.dev -- tsx scripts/list-workers.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID) {
  console.error('❌ Missing required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TASKROUTER_WORKSPACE_SID');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function listWorkers() {
  console.log('═══════════════════════════════════════════');
  console.log('📋 TASKROUTER WORKERS');
  console.log('═══════════════════════════════════════════');
  console.log(`Workspace: ${WORKSPACE_SID}\n`);

  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  if (workers.length === 0) {
    console.log('⚠️ No workers found in this workspace');
    return;
  }

  console.log(`Found ${workers.length} worker(s):\n`);

  workers.forEach((worker, index) => {
    const attrs = JSON.parse(worker.attributes || '{}');
    
    console.log(`${index + 1}. ${worker.friendlyName}`);
    console.log(`   SID: ${worker.sid}`);
    console.log(`   Activity: ${worker.activityName}`);
    console.log(`   Available: ${worker.available ? '✅ Yes' : '❌ No'}`);
    console.log(`   Email: ${attrs.email || 'N/A'}`);
    console.log(`   Contact URI: ${attrs.contact_uri || 'N/A'}`);
    console.log(`   Phone: ${attrs.phone || 'N/A'}`);
    console.log('');
  });

  console.log('═══════════════════════════════════════════');
}

listWorkers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
