/**
 * Fix TaskRouter Workflow Assignment Callback URL
 *
 * Updates the workflow to use the correct production URL for the assignment callback.
 *
 * Run with: npx dotenv -e .env.prod -- tsx scripts/fix-workflow-url.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID || !WORKFLOW_SID) {
  console.error('❌ Missing required env vars');
  process.exit(1);
}

if (!APP_URL) {
  console.error('❌ NEXT_PUBLIC_APP_URL is not set!');
  console.error('Set it to your production URL, e.g., https://your-app.vercel.app');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function fixWorkflowUrl() {
  console.log('═══════════════════════════════════════════');
  console.log('📋 FIXING WORKFLOW ASSIGNMENT CALLBACK URL');
  console.log('═══════════════════════════════════════════');

  // Get current workflow
  const workflow = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .fetch();

  console.log('\nCurrent Configuration:');
  console.log('  Assignment Callback URL:', workflow.assignmentCallbackUrl);
  console.log('  Fallback Assignment URL:', workflow.fallbackAssignmentCallbackUrl);

  const newAssignmentUrl = `${APP_URL}/api/taskrouter/assignment`;
  const newEventUrl = `${APP_URL}/api/taskrouter/events`;

  console.log('\nNew Configuration:');
  console.log('  Assignment Callback URL:', newAssignmentUrl);
  console.log('  Fallback Assignment URL:', newAssignmentUrl);

  // Update workflow
  await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .update({
      assignmentCallbackUrl: newAssignmentUrl,
      fallbackAssignmentCallbackUrl: newAssignmentUrl,
    });

  console.log('\n✅ Workflow assignment callback URL updated!');

  // Also update workspace event callback URL
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 FIXING WORKSPACE EVENT CALLBACK URL');
  console.log('═══════════════════════════════════════════');

  const workspace = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .fetch();

  console.log('\nCurrent Event Callback URL:', workspace.eventCallbackUrl);
  console.log('New Event Callback URL:', newEventUrl);

  await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .update({
      eventCallbackUrl: newEventUrl,
    });

  console.log('\n✅ Workspace event callback URL updated!');

  // Verify the changes
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 VERIFYING CHANGES');
  console.log('═══════════════════════════════════════════');

  const updatedWorkflow = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .fetch();

  const updatedWorkspace = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .fetch();

  console.log('\nWorkflow Assignment URL:', updatedWorkflow.assignmentCallbackUrl);
  console.log('Workspace Event URL:', updatedWorkspace.eventCallbackUrl);
  console.log('\n✅ All URLs updated successfully!');
}

fixWorkflowUrl()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
