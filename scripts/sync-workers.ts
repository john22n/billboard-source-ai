/**
 * Sync Workers Script
 *
 * Creates or updates TaskRouter workers for users
 * that have a Twilio phone number.
 *
 * Safe to re-run:
 * - Updates existing workers
 * - Creates missing workers
 * - Avoids duplicates
 * - Adds rate-limit protection
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
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

/** Main routing number user */
const MAIN_ROUTING_NUMBER = '+18338547126';
const MAIN_ROUTING_EMAIL = 'tech@billboardsource.com';

/** Sleep helper (rate-limit protection) */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function syncWorkers() {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 SYNCING TASKROUTER WORKERS');
  console.log('═══════════════════════════════════════════');

  /** ------------------------------------------------------------------ */
  /** Fetch existing workers                                             */
  /** ------------------------------------------------------------------ */
  const existingWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list({ limit: 200 });

  const workersByEmail = new Map(
    existingWorkers.map(w => [w.friendlyName, w])
  );

  /** ------------------------------------------------------------------ */
  /** Fetch users with Twilio numbers                                    */
  /** ------------------------------------------------------------------ */
  const users = await db
    .select()
    .from(user)
    .where(isNotNull(user.twilioPhoneNumber));

  console.log(`👥 Found ${users.length} users with Twilio numbers\n`);

  /** ------------------------------------------------------------------ */
  /** Sync each user                                                     */
  /** ------------------------------------------------------------------ */
  for (const u of users) {
    console.log(`👤 ${u.email}`);

    const isMainRoutingUser =
      u.twilioPhoneNumber === MAIN_ROUTING_NUMBER &&
      u.email === MAIN_ROUTING_EMAIL;

    const workerAttributes = {
      userId: u.id,
      email: u.email,
      phoneNumber: u.twilioPhoneNumber,
      available: false, // controlled by presence / UI
      contact_uri: `client:${u.email}`,
      role: isMainRoutingUser ? 'main-routing' : 'agent',
    };

    const existingWorker = workersByEmail.get(u.email);

    if (existingWorker) {
      console.log(`  🔁 Updating worker ${existingWorker.sid}`);

      await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers(existingWorker.sid)
        .update({
          attributes: JSON.stringify(workerAttributes),
          activitySid: ACTIVITY_OFFLINE_SID,
        });

      await db
        .update(user)
        .set({
          taskRouterWorkerSid: existingWorker.sid,
          workerActivity: 'offline',
        })
        .where(eq(user.id, u.id));

      await sleep(300);
      continue;
    }

    /** ------------------------------------------------------------------ */
    /** Create new worker                                                  */
    /** ------------------------------------------------------------------ */
    const worker = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.create({
        friendlyName: u.email,
        activitySid: ACTIVITY_OFFLINE_SID,
        attributes: JSON.stringify(workerAttributes),
      });

    console.log(`  ✅ Created worker ${worker.sid}`);

    await db
      .update(user)
      .set({
        taskRouterWorkerSid: worker.sid,
        workerActivity: 'offline',
      })
      .where(eq(user.id, u.id));

    await sleep(300);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ WORKER SYNC COMPLETE');
  console.log('═══════════════════════════════════════════');
}

/** ------------------------------------------------------------------ */
/** RUN                                                                */
/** ------------------------------------------------------------------ */
syncWorkers()
  .then(() => {
    console.log('\n🎉 Sync completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Sync failed:', err);
    process.exit(1);
  });

