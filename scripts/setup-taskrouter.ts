/**
 * TaskRouter Setup Script
 *
 * Provisions TaskRouter workspace, activities, queues, and workflow
 * for inbound call routing with:
 * - Main number → random reps (20s → next rep → voicemail)
 * - Direct numbers → specific rep → voicemail
 *
 * Safe to rerun: deletes old workspace with same name, waits between API calls to prevent rate limits.
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('❌ Missing TWILIO credentials');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const MAIN_ROUTING_NUMBER = '+18338547126';

/**
 * Direct phone numbers (one per user)
 * These must match the worker.phoneNumber attribute
 */
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
  MAIN_ROUTING_NUMBER,
];

/** Simple sleep helper */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function setupTaskRouter() {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 TASKROUTER SETUP STARTING');
  console.log('═══════════════════════════════════════════');

  const workspaceFriendlyName = 'Billboard Source Sales';

  // Check for existing workspace
  console.log('🔍 Checking for existing workspace...');
  const existingWorkspaces = await client.taskrouter.v1.workspaces.list({ friendlyName: workspaceFriendlyName });
  if (existingWorkspaces.length > 0) {
    console.log(`🗑 Deleting existing workspace: ${existingWorkspaces[0].sid}`);
    await client.taskrouter.v1.workspaces(existingWorkspaces[0].sid).remove();
    await sleep(2000); // wait 2s to avoid rate limits
  }

  // Create workspace
  console.log('📦 Creating workspace...');
  const workspace = await client.taskrouter.v1.workspaces.create({
    friendlyName: workspaceFriendlyName,
    eventCallbackUrl: `${APP_URL}/api/taskrouter/events`,
    eventsFilter:
      'task.created,task.canceled,task-queue.entered,reservation.created,reservation.accepted,reservation.rejected,reservation.timeout,reservation.canceled',
  });
  const workspaceSid = workspace.sid;
  console.log(`✅ Created workspace: ${workspaceSid}`);
  await sleep(1000);

  /** ------------------------------------------------------------------ */
  /** 1️⃣ Activities                                                     */
  /** ------------------------------------------------------------------ */
  console.log('\n📌 Creating/Checking activities...');

  async function findOrCreateActivity(name: string, available: boolean) {
    const existing = await client.taskrouter.v1.workspaces(workspaceSid).activities.list({ friendlyName: name });
    if (existing.length > 0) return existing[0];
    const activity = await client.taskrouter.v1.workspaces(workspaceSid).activities.create({ friendlyName: name, available });
    await sleep(500);
    return activity;
  }

  const available = await findOrCreateActivity('Available', true);
  const unavailable = await findOrCreateActivity('Unavailable', false);
  const offline = await findOrCreateActivity('Offline', false);

  /** ------------------------------------------------------------------ */
  /** 2️⃣ Queues                                                         */
  /** ------------------------------------------------------------------ */
  console.log('\n📌 Creating/Checking queues...');

  async function findOrCreateQueue(
    name: string,
    targetWorkers: string,
    reservationSid: string,
    assignmentSid: string
  ) {
    const existing = await client.taskrouter.v1.workspaces(workspaceSid).taskQueues.list({ friendlyName: name });
    if (existing.length > 0) return existing[0];
    const queue = await client.taskrouter.v1.workspaces(workspaceSid).taskQueues.create({
      friendlyName: name,
      targetWorkers,
      reservationActivitySid: reservationSid,
      assignmentActivitySid: assignmentSid,
    });
    await sleep(500);
    return queue;
  }

  const mainQueue = await findOrCreateQueue('Main Random Queue', 'available == true', unavailable.sid, unavailable.sid);
  const directQueues: Record<string, string> = {};

  for (const num of DIRECT_NUMBERS) {
    const queue = await findOrCreateQueue(
      `Direct ${num}`,
      `phoneNumber == "${num}" AND available == true`,
      unavailable.sid,
      unavailable.sid
    );
    directQueues[num] = queue.sid;
  }

  const voicemailQueue = await findOrCreateQueue('Voicemail', '1==2', unavailable.sid, unavailable.sid);

  /** ------------------------------------------------------------------ */
  /** 3️⃣ Workflow                                                       */
  /** ------------------------------------------------------------------ */
  console.log('\n🧠 Creating workflow...');

  const workflowConfig = {
    task_routing: {
      filters: [
        // Direct numbers
        ...DIRECT_NUMBERS.map(num => ({
          filter_friendly_name: `Direct ${num}`,
          expression: `callTo == "${num}"`,
          targets: [
            { queue: directQueues[num], timeout: 20 },
            { queue: voicemailQueue.sid },
          ],
        })),
        // Main number
        {
          filter_friendly_name: 'Main Number',
          expression: `callTo == "${MAIN_ROUTING_NUMBER}"`,
          targets: [
            { queue: mainQueue.sid, timeout: 20 },
            { queue: mainQueue.sid, timeout: 20 },
            { queue: voicemailQueue.sid },
          ],
        },
      ],
      default_filter: { queue: voicemailQueue.sid },
    },
  };

  const workflow = await client.taskrouter.v1.workspaces(workspaceSid).workflows.create({
    friendlyName: 'Inbound Sales Routing',
    configuration: JSON.stringify(workflowConfig),
    assignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
    fallbackAssignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
    taskReservationTimeout: 20,
  });
  console.log(`✅ Workflow created: ${workflow.sid}`);
  await sleep(500);

  /** ------------------------------------------------------------------ */
  /** OUTPUT                                                             */
  /** ------------------------------------------------------------------ */
  console.log('\n═══════════════════════════════════════════');
  console.log('✅ TASKROUTER SETUP COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`TASKROUTER_WORKSPACE_SID=${workspaceSid}`);
  console.log(`TASKROUTER_WORKFLOW_SID=${workflow.sid}`);
  console.log(`TASKROUTER_MAIN_QUEUE_SID=${mainQueue.sid}`);
  console.log(`TASKROUTER_VOICEMAIL_QUEUE_SID=${voicemailQueue.sid}`);
  console.log(`TASKROUTER_ACTIVITY_AVAILABLE_SID=${available.sid}`);
  console.log(`TASKROUTER_ACTIVITY_UNAVAILABLE_SID=${unavailable.sid}`);
  console.log(`TASKROUTER_ACTIVITY_OFFLINE_SID=${offline.sid}`);
  console.log('\nDirect Queues:');
  console.log(JSON.stringify(directQueues, null, 2));
}

/** ------------------------------------------------------------------ */
/** RUN                                                                */
/** ------------------------------------------------------------------ */
setupTaskRouter()
  .then(() => {
    console.log('\n🎉 Setup completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Setup failed:', err);
    process.exit(1);
  });

