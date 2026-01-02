/**
 * TaskRouter Event Callback
 * 
 * Handles TaskRouter events, particularly when a task enters the Voicemail queue.
 * When no agents answer or none are available, redirects the call to voicemail.
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

function getAppUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const eventType = formData.get('EventType') as string;
    const taskSid = formData.get('TaskSid') as string;
    const taskAttributes = formData.get('TaskAttributes') as string;
    const taskQueueName = formData.get('TaskQueueName') as string;
    const workspaceSid = formData.get('WorkspaceSid') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📡 TASKROUTER EVENT');
    console.log('═══════════════════════════════════════════');
    console.log('EventType:', eventType);
    console.log('TaskSid:', taskSid);
    console.log('TaskQueueName:', taskQueueName);
    console.log('═══════════════════════════════════════════');

    // Handle task entering Voicemail queue
    if (eventType === 'task-queue.entered' && taskQueueName === 'Voicemail') {
      console.log('📨 Task entered Voicemail queue - redirecting to voicemail');

      let attrs: { call_sid?: string } = {};
      try {
        attrs = JSON.parse(taskAttributes || '{}');
      } catch {
        console.error('Failed to parse task attributes');
      }

      const callSid = attrs.call_sid;
      if (!callSid) {
        console.error('❌ No call_sid in task attributes');
        return new Response(null, { status: 204 });
      }

      // Redirect the call to voicemail
      const appUrl = getAppUrl(req);
      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;
      
      await client.calls(callSid).update({
        method: 'POST',
        url: encodeURI(voicemailUrl),
      });

      console.log('✅ Call redirected to voicemail');
    }

    // Handle reservation timeout (for logging)
    if (eventType === 'reservation.timeout') {
      const workerSid = formData.get('WorkerSid') as string;
      console.log(`⏰ Reservation timeout for worker: ${workerSid}`);
      console.log('TaskRouter will try next available worker or escalate');
    }

    // Handle reservation rejected - TaskRouter will automatically try next available worker
    if (eventType === 'reservation.rejected') {
      const workerSid = formData.get('WorkerSid') as string;
      console.log(`🚫 Reservation rejected by worker: ${workerSid}`);
      console.log('📞 TaskRouter routing to next available worker');
    }

    // Handle task canceled (for logging)
    if (eventType === 'task.canceled') {
      console.log('🗑️ Task canceled');
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Event callback error:', error);
    return new Response(null, { status: 500 });
  }
}
