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

    const taskQueueSid = formData.get('TaskQueueSid') as string;
    const workerSid = formData.get('WorkerSid') as string;
    const reservationSid = formData.get('ReservationSid') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📡 TASKROUTER EVENT');
    console.log('═══════════════════════════════════════════');
    console.log('EventType:', eventType);
    console.log('TaskSid:', taskSid);
    console.log('TaskQueueName:', taskQueueName);
    console.log('TaskQueueSid:', taskQueueSid);
    console.log('WorkerSid:', workerSid || 'N/A');
    console.log('ReservationSid:', reservationSid || 'N/A');
    console.log('TaskAttributes:', taskAttributes);
    console.log('═══════════════════════════════════════════');

    // Log task created - shows if task was created and what queue it's targeting
    if (eventType === 'task.created') {
      console.log('📋 Task created - waiting for worker assignment');
    }

    // Log when task enters a queue
    if (eventType === 'task-queue.entered') {
      console.log(`📥 Task entered queue: ${taskQueueName}`);
      if (taskQueueName === 'Sales Queue') {
        console.log('✅ Task in Sales Queue - looking for available workers');
      }
    }

    // Log reservation created - a worker was found
    if (eventType === 'reservation.created') {
      console.log(`🔔 Reservation created for worker: ${workerSid}`);
      console.log('📞 Calling assignment callback...');
    }

    // Log reservation accepted
    if (eventType === 'reservation.accepted') {
      console.log(`✅ Reservation accepted by worker: ${workerSid}`);
    }

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

      // Cancel the task FIRST to prevent re-enqueue loop
      // When we redirect the call, it leaves the Enqueue which can trigger
      // the Voice URL again. Canceling the task first breaks this cycle.
      if (taskSid && workspaceSid) {
        try {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'canceled',
              reason: 'Routing to voicemail',
            });
          console.log('✅ Task canceled before voicemail redirect');
        } catch (err) {
          console.error('Failed to cancel task:', err);
        }
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
