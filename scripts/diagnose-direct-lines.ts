/**
 * Diagnose Direct Line Routing Issues
 *
 * Checks for common issues that prevent direct line calls from reaching users:
 * 1. Users missing twilioPhoneNumber in database
 * 2. Users without TaskRouter workers
 * 3. Workers with mismatched phoneNumber attribute
 * 4. Direct queues with no eligible workers
 *
 * Run with: npx dotenv -e .env.prod -- tsx scripts/diagnose-direct-lines.ts
 */

import twilio from 'twilio';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const DATABASE_URL = process.env.DATABASE_URL!;

if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID || !DATABASE_URL) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function diagnose() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 DIRECT LINE ROUTING DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Get all users from database
  const users = await db.select().from(schema.user);
  console.log(`📋 Total users in database: ${users.length}\n`);

  // 2. Get all TaskRouter workers
  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  const workersByEmail = new Map<string, typeof workers[0]>();
  for (const w of workers) {
    const attrs = JSON.parse(w.attributes || '{}');
    if (attrs.email) {
      workersByEmail.set(attrs.email, w);
    }
  }

  // 3. Get all direct queues and their stats
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();

  const directQueues = queues.filter(q => q.friendlyName.startsWith('Direct '));

  // 4. Check each user
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('👤 USER STATUS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const issues: string[] = [];

  for (const u of users) {
    const worker = workersByEmail.get(u.email);
    const workerAttrs = worker ? JSON.parse(worker.attributes || '{}') : null;

    console.log(`📧 ${u.email}`);
    console.log(`   DB twilioPhoneNumber: ${u.twilioPhoneNumber || '❌ NOT SET'}`);
    console.log(`   DB workerActivity: ${u.workerActivity || 'offline'}`);
    console.log(`   DB taskRouterWorkerSid: ${u.taskRouterWorkerSid || '❌ NOT SET'}`);

    if (worker) {
      console.log(`   TaskRouter Worker: ${worker.sid}`);
      console.log(`   Worker Activity: ${worker.activityName} (available: ${worker.available})`);
      console.log(`   Worker phoneNumber attr: ${workerAttrs?.phoneNumber || '❌ NOT SET'}`);
      console.log(`   Worker contact_uri: ${workerAttrs?.contact_uri || '❌ NOT SET'}`);

      // Check for mismatches
      if (u.twilioPhoneNumber && workerAttrs?.phoneNumber !== u.twilioPhoneNumber) {
        const issue = `⚠️  MISMATCH: ${u.email} - DB has ${u.twilioPhoneNumber}, worker has ${workerAttrs?.phoneNumber}`;
        console.log(`   ${issue}`);
        issues.push(issue);
      }
    } else {
      console.log(`   TaskRouter Worker: ❌ NO WORKER FOUND`);
      if (u.twilioPhoneNumber) {
        const issue = `⚠️  NO WORKER: ${u.email} has phone ${u.twilioPhoneNumber} but no TaskRouter worker`;
        issues.push(issue);
      }
    }

    // Check if user has a phone but is missing from direct queue eligibility
    if (!u.twilioPhoneNumber && u.role !== 'admin') {
      const issue = `⚠️  MISSING PHONE: ${u.email} has no twilioPhoneNumber set`;
      issues.push(issue);
    }

    console.log('');
  }

  // 5. Check direct queues
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📞 DIRECT QUEUE STATUS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const queue of directQueues) {
    const phoneNumber = queue.friendlyName.replace('Direct ', '');
    const stats = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .taskQueues(queue.sid)
      .realTimeStatistics()
      .fetch();

    console.log(`📞 ${phoneNumber}`);
    console.log(`   Queue SID: ${queue.sid}`);
    console.log(`   Target Workers: ${queue.targetWorkers}`);
    console.log(`   Eligible Workers: ${stats.totalEligibleWorkers}`);
    console.log(`   Available Workers: ${stats.totalAvailableWorkers}`);

    if (stats.totalEligibleWorkers === 0) {
      const issue = `⚠️  NO ELIGIBLE WORKERS for ${phoneNumber} - calls will go to voicemail`;
      console.log(`   ${issue}`);
      issues.push(issue);
    } else if (stats.totalAvailableWorkers === 0) {
      console.log(`   ℹ️  No workers currently available (eligible: ${stats.totalEligibleWorkers})`);
    }
    console.log('');
  }

  // 6. Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (issues.length === 0) {
    console.log('✅ No issues found! All users are properly configured.\n');
  } else {
    console.log(`❌ Found ${issues.length} issue(s):\n`);
    for (const issue of issues) {
      console.log(`   ${issue}`);
    }
    console.log('\n');
    console.log('💡 RECOMMENDED FIXES:');
    console.log('   1. For missing phones: Update user.twilioPhoneNumber in database');
    console.log('   2. For missing workers: User needs to toggle status to "Available" once');
    console.log('   3. For mismatches: Run sync-workers.ts to update worker attributes');
    console.log('   4. For no eligible workers: Ensure phone number matches exactly (+1XXXXXXXXXX format)\n');
  }

  await pool.end();
}

diagnose()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
