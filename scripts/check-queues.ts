import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('📥 QUEUE CONFIGURATION');
  console.log('═══════════════════════════════════════════\n');

  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list();

  for (const q of queues) {
    console.log(`\n${q.friendlyName}:`);
    console.log(`   SID: ${q.sid}`);
    console.log(`   targetWorkers: ${q.targetWorkers}`);
    console.log(`   reservationActivitySid: ${q.reservationActivitySid}`);
    console.log(`   assignmentActivitySid: ${q.assignmentActivitySid}`);
    
    // Get eligible workers for this queue
    const workers = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.list({ targetWorkersExpression: q.targetWorkers });
    
    console.log(`   Eligible workers (${workers.length}):`);
    for (const w of workers) {
      console.log(`      - ${w.friendlyName}: ${w.activityName}`);
    }
  }

  // Get workflow config
  console.log('\n═══════════════════════════════════════════');
  console.log('🧠 WORKFLOW CONFIGURATION');
  console.log('═══════════════════════════════════════════\n');

  const workflows = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows.list();

  for (const wf of workflows) {
    console.log(`${wf.friendlyName}:`);
    console.log(`   taskReservationTimeout: ${wf.taskReservationTimeout}s`);
    
    const config = JSON.parse(wf.configuration);
    console.log('\n   Routing filters:');
    for (const filter of config.task_routing?.filters || []) {
      console.log(`\n   📍 ${filter.filter_friendly_name}`);
      console.log(`      expression: ${filter.expression}`);
      console.log(`      targets:`);
      for (const target of filter.targets || []) {
        const queue = queues.find(q => q.sid === target.queue);
        console.log(`         → ${queue?.friendlyName || target.queue} (timeout: ${target.timeout}s)`);
      }
    }
  }
}

check().catch(console.error);
