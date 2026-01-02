/**
 * Check Recent TaskRouter Tasks
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/check-recent-tasks.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function checkRecentTasks() {
  console.log('═══════════════════════════════════════════');
  console.log('📋 RECENT TASKS');
  console.log('═══════════════════════════════════════════');
  
  const tasks = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .tasks.list({ limit: 5, ordering: 'DateCreated:desc' });
  
  if (tasks.length === 0) {
    console.log('No recent tasks found');
    return;
  }
  
  for (const task of tasks) {
    console.log(`\nTask ${task.sid}`);
    console.log(`  Status: ${task.assignmentStatus}`);
    console.log(`  Reason: ${task.reason || 'N/A'}`);
    console.log(`  Queue: ${task.taskQueueFriendlyName}`);
    console.log(`  Created: ${task.dateCreated}`);
    console.log(`  Attributes: ${task.attributes}`);
  }
}

checkRecentTasks()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
