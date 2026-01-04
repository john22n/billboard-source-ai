/**
 * Cleanup Voicemail Queues
 * 
 * 1. Updates the workflow to only use Sales Queue
 * 2. Sets voicemail worker to offline
 * 3. Deletes voicemail queues and worker
 * 
 * Run: npx tsx scripts/cleanup-voicemail-queues.ts
 */

import twilio from 'twilio';
import 'dotenv/config';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!;
const OFFLINE_ACTIVITY_SID = process.env.TASKROUTER_ACTIVITY_OFFLINE_SID!;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID) {
  console.error('❌ Missing required env vars');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function cleanup() {
  console.log('🧹 Cleaning up voicemail queues and workers...\n');

  // Step 1: Get Sales Queue SID
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();

  console.log('📋 Current Task Queues:');
  queues.forEach(q => console.log(`  - ${q.friendlyName} (${q.sid})`));

  const salesQueue = queues.find(q => q.friendlyName === 'Sales Queue');
  if (!salesQueue) {
    console.error('❌ Sales Queue not found');
    process.exit(1);
  }

  // Step 2: Update workflow to only use Sales Queue (simple routing, no voicemail escalation)
  if (WORKFLOW_SID) {
    console.log('\n📝 Updating workflow to remove voicemail queue references...');
    
    const simpleConfig = {
      task_routing: {
        filters: [
          {
            filter_friendly_name: 'Sales',
            expression: '1==1',
            targets: [
              {
                queue: salesQueue.sid,
                timeout: 120  // 2 minutes total timeout
              }
            ]
          }
        ],
        default_filter: {
          queue: salesQueue.sid
        }
      }
    };

    try {
      await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workflows(WORKFLOW_SID)
        .update({
          configuration: JSON.stringify(simpleConfig),
          taskReservationTimeout: 20
        });
      console.log('   ✅ Workflow updated');
    } catch (error: any) {
      console.log(`   ❌ Failed to update workflow: ${error.message}`);
    }
  }

  // Step 3: Set voicemail worker offline and delete
  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  const voicemailWorkers = workers.filter(w => {
    const attrs = JSON.parse(w.attributes || '{}');
    return attrs.email === 'voicemail@system';
  });

  for (const worker of voicemailWorkers) {
    console.log(`\n🔄 Setting worker offline: ${worker.friendlyName}`);
    try {
      if (OFFLINE_ACTIVITY_SID) {
        await client.taskrouter.v1
          .workspaces(WORKSPACE_SID)
          .workers(worker.sid)
          .update({ activitySid: OFFLINE_ACTIVITY_SID });
        console.log('   ✅ Set to offline');
      }

      console.log(`🗑️  Deleting worker: ${worker.friendlyName}`);
      await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers(worker.sid)
        .remove();
      console.log('   ✅ Deleted');
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }

  // Step 4: Delete voicemail queues
  const voicemailQueues = queues.filter(q => 
    q.friendlyName.toLowerCase().includes('voicemail')
  );

  for (const queue of voicemailQueues) {
    console.log(`\n🗑️  Deleting queue: ${queue.friendlyName}`);
    try {
      await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .taskQueues(queue.sid)
        .remove();
      console.log('   ✅ Deleted');
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }

  // Step 5: Also delete any old workflows that reference voicemail
  console.log('\n📋 Checking for old workflows...');
  const workflows = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows.list();
  
  workflows.forEach(w => console.log(`  - ${w.friendlyName} (${w.sid})`));

  // Delete any workflows other than the main one
  for (const wf of workflows) {
    if (wf.sid !== WORKFLOW_SID) {
      console.log(`\n🗑️  Deleting old workflow: ${wf.friendlyName}`);
      try {
        await client.taskrouter.v1
          .workspaces(WORKSPACE_SID)
          .workflows(wf.sid)
          .remove();
        console.log('   ✅ Deleted');
      } catch (error: any) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }
  }

  // Final status
  const remainingQueues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();

  console.log('\n✅ Remaining Task Queues:');
  remainingQueues.forEach(q => console.log(`  - ${q.friendlyName} (${q.sid})`));

  const remainingWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  console.log('\n✅ Remaining Workers:');
  remainingWorkers.forEach(w => console.log(`  - ${w.friendlyName}`));

  console.log('\n🎉 Cleanup complete!');
}

cleanup().catch(console.error);
