import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('📡 RECENT EVENTS (last 50)');
  console.log('═══════════════════════════════════════════\n');

  const events = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .events.list({ limit: 50 });

  for (const e of events) {
    let data: Record<string, unknown> = {};
    try {
      data = typeof e.eventData === 'string' ? JSON.parse(e.eventData) : e.eventData;
    } catch {
      data = e.eventData as Record<string, unknown>;
    }
    
    let taskAttrs: Record<string, unknown> = {};
    try {
      if (data.task_attributes) {
        taskAttrs = typeof data.task_attributes === 'string' 
          ? JSON.parse(data.task_attributes) 
          : data.task_attributes;
      }
    } catch {}
    
    console.log(`${e.eventType} @ ${e.eventDate}`);
    if (taskAttrs.callTo) {
      console.log(`   To: ${taskAttrs.callTo} | From: ${taskAttrs.from || 'N/A'} | Type: ${taskAttrs.callType}`);
    }
    if (data.worker_name) {
      console.log(`   Worker: ${data.worker_name}`);
    }
    if (data.task_queue_name) {
      console.log(`   Queue: ${data.task_queue_name}`);
    }
    if (data.task_canceled_reason || data.reservation_canceled_reason) {
      console.log(`   Reason: ${data.task_canceled_reason || data.reservation_canceled_reason}`);
    }
    console.log('');
  }

  // Show current workers and their status
  console.log('═══════════════════════════════════════════');
  console.log('👷 CURRENT WORKER STATUS');
  console.log('═══════════════════════════════════════════\n');

  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  for (const w of workers) {
    const attrs = JSON.parse(w.attributes);
    console.log(`${w.friendlyName}: ${w.activityName} (available: ${w.available})`);
    if (attrs.phoneNumber) {
      console.log(`   Direct line: ${attrs.phoneNumber}`);
    }
  }
}

check().catch(console.error);
