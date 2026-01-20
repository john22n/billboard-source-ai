/**
 * Setup Voicemail Worker
 *
 * Creates/updates the voicemail worker and updates the Voicemail queue
 * to target workers with role == "voicemail".
 *
 * Run with: npx dotenv -e .env.prod -- tsx scripts/setup-voicemail-worker.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID) {
  console.error('❌ Missing TWILIO credentials or WORKSPACE_SID');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function setupVoicemailWorker() {
  console.log('═══════════════════════════════════════════');
  console.log('📼 VOICEMAIL WORKER SETUP');
  console.log('═══════════════════════════════════════════');
  console.log('Workspace:', WORKSPACE_SID);

  // Get Available activity
  const activities = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .activities.list();

  const availableActivity = activities.find(a => a.friendlyName === 'Available');
  if (!availableActivity) {
    throw new Error('Available activity not found');
  }

  // Check/create voicemail worker
  const voicemailWorkerAttrs = {
    email: 'voicemail@system',
    role: 'voicemail',
    contact_uri: 'client:voicemail',
  };

  const existingWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list({ friendlyName: 'Voicemail Worker' });

  let voicemailWorker;
  if (existingWorkers.length > 0) {
    voicemailWorker = existingWorkers[0];
    console.log(`ℹ️ Voicemail worker exists: ${voicemailWorker.sid}`);

    // Update attributes to ensure they're correct
    await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers(voicemailWorker.sid)
      .update({
        activitySid: availableActivity.sid,
        attributes: JSON.stringify(voicemailWorkerAttrs),
      });
    console.log('✅ Updated voicemail worker attributes');
  } else {
    voicemailWorker = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.create({
        friendlyName: 'Voicemail Worker',
        activitySid: availableActivity.sid,
        attributes: JSON.stringify(voicemailWorkerAttrs),
      });
    console.log(`✅ Created voicemail worker: ${voicemailWorker.sid}`);
  }

  // Update Voicemail queue to target role == "voicemail"
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();

  const voicemailQueue = queues.find(q => q.friendlyName === 'Voicemail');
  if (!voicemailQueue) {
    throw new Error('Voicemail queue not found');
  }

  console.log(`\n📥 Updating Voicemail queue: ${voicemailQueue.sid}`);
  console.log(`   Current targetWorkers: ${voicemailQueue.targetWorkers}`);

  await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues(voicemailQueue.sid)
    .update({
      targetWorkers: 'role == "voicemail"',
    });

  console.log('✅ Updated Voicemail queue targetWorkers to: role == "voicemail"');

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ VOICEMAIL WORKER SETUP COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`VOICEMAIL_WORKER_SID=${voicemailWorker.sid}`);
}

setupVoicemailWorker()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
