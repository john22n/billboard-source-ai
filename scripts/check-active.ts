import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('📞 IN-PROGRESS CALLS');
  console.log('═══════════════════════════════════════════\n');

  const inProgressCalls = await client.calls.list({ status: 'in-progress', limit: 20 });
  
  if (inProgressCalls.length === 0) {
    console.log('No calls currently in progress');
  } else {
    for (const call of inProgressCalls) {
      console.log(`🔴 ACTIVE: ${call.from} → ${call.to}`);
      console.log(`   Started: ${call.startTime}`);
      console.log(`   Duration: ${call.duration}s`);
      console.log('');
    }
  }

  console.log('═══════════════════════════════════════════');
  console.log('📋 ACTIVE TASKS');
  console.log('═══════════════════════════════════════════\n');

  const tasks = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .tasks.list({ assignmentStatus: 'assigned', limit: 20 });

  if (tasks.length === 0) {
    console.log('No active tasks');
  } else {
    for (const t of tasks) {
      const attrs = JSON.parse(t.attributes);
      console.log(`🔴 TASK: ${t.sid.slice(-8)}`);
      console.log(`   From: ${attrs.from} → To: ${attrs.callTo}`);
      console.log(`   Created: ${t.dateCreated}`);
      console.log('');
    }
  }

  console.log('═══════════════════════════════════════════');
  console.log('👷 BUSY WORKERS (Unavailable)');
  console.log('═══════════════════════════════════════════\n');

  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  const busyWorkers = workers.filter(w => w.activityName === 'Unavailable');
  
  if (busyWorkers.length === 0) {
    console.log('No workers currently busy');
  } else {
    for (const w of busyWorkers) {
      console.log(`🔴 ${w.friendlyName}: Unavailable`);
    }
  }
}

check().catch(console.error);
