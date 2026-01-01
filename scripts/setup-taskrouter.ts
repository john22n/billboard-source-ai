/**
 * TaskRouter Setup Script
 * 
 * This script provisions the TaskRouter workspace, activities, queue, and workflow
 * for the Billboard Source inbound call routing system.
 * 
 * Run with: npx dotenv -e .env.dev -- tsx scripts/setup-taskrouter.ts
 * Or for prod: npx dotenv -e .env.prod -- tsx scripts/setup-taskrouter.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('❌ Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

interface SetupResult {
  workspaceSid: string;
  activities: {
    available: string;
    unavailable: string;
    offline: string;
  };
  salesQueueSid: string;
  voicemailQueueSid: string;
  workflowSid: string;
}

async function setupTaskRouter(): Promise<SetupResult> {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 TASKROUTER SETUP STARTING');
  console.log('═══════════════════════════════════════════');

  // 1. Create Workspace
  console.log('\n1️⃣ Creating Workspace...');
  const workspace = await client.taskrouter.v1.workspaces.create({
    friendlyName: 'Billboard Source Sales',
    eventCallbackUrl: `${APP_URL}/api/taskrouter/events`,
    eventsFilter: 'task.created,task.canceled,task-queue.entered,reservation.created,reservation.accepted,reservation.rejected,reservation.timeout,reservation.canceled',
  });
  console.log(`✅ Workspace created: ${workspace.sid}`);

  const workspaceSid = workspace.sid;

  // 2. Get or Create Activities
  console.log('\n2️⃣ Setting up Activities...');

  // Fetch existing activities (workspaces come with defaults)
  const existingActivities = await client.taskrouter.v1
    .workspaces(workspaceSid)
    .activities.list();

  const findOrCreateActivity = async (name: string, available: boolean) => {
    const existing = existingActivities.find(a => a.friendlyName === name);
    if (existing) {
      console.log(`✅ Activity '${name}' found: ${existing.sid}`);
      return existing;
    }
    const created = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .activities.create({ friendlyName: name, available });
    console.log(`✅ Activity '${name}' created: ${created.sid}`);
    return created;
  };

  const availableActivity = await findOrCreateActivity('Available', true);
  const unavailableActivity = await findOrCreateActivity('Unavailable', false);
  const offlineActivity = await findOrCreateActivity('Offline', false);

  // 3. Create Task Queues
  console.log('\n3️⃣ Creating Task Queues...');
  
  // Sales Queue - for available reps
  const salesQueue = await client.taskrouter.v1
    .workspaces(workspaceSid)
    .taskQueues.create({
      friendlyName: 'Sales Queue',
      targetWorkers: '1==1', // All workers can receive tasks
      reservationActivitySid: unavailableActivity.sid, // When reserved, set to unavailable
      assignmentActivitySid: unavailableActivity.sid,
    });
  console.log(`✅ Sales Queue created: ${salesQueue.sid}`);

  // Voicemail Queue - impossible to match (1==2), used as fallback
  const voicemailQueue = await client.taskrouter.v1
    .workspaces(workspaceSid)
    .taskQueues.create({
      friendlyName: 'Voicemail',
      targetWorkers: '1==2', // No workers will ever match
    });
  console.log(`✅ Voicemail Queue created: ${voicemailQueue.sid}`);

  // 4. Create Workflow with escalation logic
  console.log('\n4️⃣ Creating Workflow...');
  
  const workflowConfig = {
    task_routing: {
      filters: [
        {
          filter_friendly_name: 'Sales',
          expression: '1==1',
          targets: [
            {
              queue: salesQueue.sid,
              timeout: 20, // 20 seconds to first rep
              skip_if: 'workers.available == 0',
            },
            {
              queue: salesQueue.sid,
              timeout: 20, // 20 seconds to second rep
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

  const workflow = await client.taskrouter.v1
    .workspaces(workspaceSid)
    .workflows.create({
      friendlyName: 'Inbound Sales Routing',
      configuration: JSON.stringify(workflowConfig),
      assignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
      fallbackAssignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
      taskReservationTimeout: 20,
    });
  console.log(`✅ Workflow created: ${workflow.sid}`);

  // Print summary
  console.log('\n═══════════════════════════════════════════');
  console.log('✅ TASKROUTER SETUP COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log('\nAdd these to your .env file:\n');
  console.log(`TASKROUTER_WORKSPACE_SID=${workspaceSid}`);
  console.log(`TASKROUTER_WORKFLOW_SID=${workflow.sid}`);
  console.log(`TASKROUTER_SALES_QUEUE_SID=${salesQueue.sid}`);
  console.log(`TASKROUTER_VOICEMAIL_QUEUE_SID=${voicemailQueue.sid}`);
  console.log(`TASKROUTER_ACTIVITY_AVAILABLE_SID=${availableActivity.sid}`);
  console.log(`TASKROUTER_ACTIVITY_UNAVAILABLE_SID=${unavailableActivity.sid}`);
  console.log(`TASKROUTER_ACTIVITY_OFFLINE_SID=${offlineActivity.sid}`);
  console.log('\n═══════════════════════════════════════════');

  return {
    workspaceSid,
    activities: {
      available: availableActivity.sid,
      unavailable: unavailableActivity.sid,
      offline: offlineActivity.sid,
    },
    salesQueueSid: salesQueue.sid,
    voicemailQueueSid: voicemailQueue.sid,
    workflowSid: workflow.sid,
  };
}

// Run setup
setupTaskRouter()
  .then(() => {
    console.log('\n🎉 Setup completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  });
