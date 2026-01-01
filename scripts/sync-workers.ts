/**
 * Sync Workers Script
 * 
 * Creates TaskRouter workers for all users with Twilio phone numbers.
 * Run after setup-taskrouter.ts
 * 
 * Run with: npx dotenv -e .env.dev -- tsx scripts/sync-workers.ts
 */

import twilio from 'twilio';
import { db } from '../db';
import { user } from '../db/schema';
import { eq, isNotNull } from 'drizzle-orm';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const ACTIVITY_OFFLINE_SID = process.env.TASKROUTER_ACTIVITY_OFFLINE_SID!;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID || !ACTIVITY_OFFLINE_SID) {
  console.error('❌ Missing required environment variables');
  console.error('Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TASKROUTER_WORKSPACE_SID, TASKROUTER_ACTIVITY_OFFLINE_SID');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function syncWorkers() {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 SYNCING WORKERS');
  console.log('═══════════════════════════════════════════');

  // Fetch existing workers from TaskRouter
  const existingWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  const workersByEmail = new Map(existingWorkers.map(w => [w.friendlyName, w]));
  console.log(`\nFound ${existingWorkers.length} existing workers in TaskRouter`);

  // Get all users with Twilio phone numbers
  const users = await db
    .select()
    .from(user)
    .where(isNotNull(user.twilioPhoneNumber));

  console.log(`Found ${users.length} users with Twilio phone numbers\n`);

  for (const u of users) {
    console.log(`Processing: ${u.email}`);

    // Check if worker SID already in DB
    if (u.taskRouterWorkerSid) {
      console.log(`  ⚠️ Already synced: ${u.taskRouterWorkerSid}`);
      continue;
    }

    // Check if worker exists in TaskRouter
    const existingWorker = workersByEmail.get(u.email);
    if (existingWorker) {
      console.log(`  📎 Found existing worker: ${existingWorker.sid}`);
      await db
        .update(user)
        .set({
          taskRouterWorkerSid: existingWorker.sid,
          workerActivity: 'offline',
        })
        .where(eq(user.id, u.id));
      console.log(`  ✅ Updated database`);
      continue;
    }

    try {
      // Create new worker in TaskRouter
      const worker = await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers.create({
          friendlyName: u.email,
          activitySid: ACTIVITY_OFFLINE_SID,
          attributes: JSON.stringify({
            email: u.email,
            contact_uri: `client:${u.email}`,
            phone: u.twilioPhoneNumber,
          }),
        });

      console.log(`  ✅ Created worker: ${worker.sid}`);

      // Update user in database
      await db
        .update(user)
        .set({
          taskRouterWorkerSid: worker.sid,
          workerActivity: 'offline',
        })
        .where(eq(user.id, u.id));

      console.log(`  ✅ Updated database`);
    } catch (error) {
      console.error(`  ❌ Failed to create worker:`, error);
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ WORKER SYNC COMPLETE');
  console.log('═══════════════════════════════════════════');
}

syncWorkers()
  .then(() => {
    console.log('\n🎉 Sync completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Sync failed:', error);
    process.exit(1);
  });
