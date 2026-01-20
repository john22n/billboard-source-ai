/**
 * TaskRouter Event Callback
 *
 * Handles TaskRouter events including voicemail redirect.
 * When a task enters the Voicemail queue, we redirect the call to voicemail TwiML.
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

export async function POST(req: Request) {
  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  
  try {
    const formData = await req.formData();

    const eventType = formData.get('EventType') as string;
    const taskSid = formData.get('TaskSid') as string;
    const taskQueueName = formData.get('TaskQueueName') as string;
    const taskQueueSid = formData.get('TaskQueueSid') as string;
    const workerSid = formData.get('WorkerSid') as string;
    const reservationSid = formData.get('ReservationSid') as string;
    const taskAttributes = formData.get('TaskAttributes') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📡 TASKROUTER EVENT');
    console.log('EventType:', eventType);
    console.log('TaskSid:', taskSid);
    console.log('TaskQueueName:', taskQueueName || 'N/A');
    console.log('TaskQueueSid:', taskQueueSid || 'N/A');
    console.log('WorkerSid:', workerSid || 'N/A');
    console.log('ReservationSid:', reservationSid || 'N/A');
    console.log('═══════════════════════════════════════════');

    switch (eventType) {
      case 'task.created':
        console.log('📋 Task created');
        break;

      case 'task-queue.entered':
        console.log(`📥 Task entered queue: ${taskQueueName}`);
        
        // Redirect to voicemail when task enters Voicemail queue
        if (taskQueueName === 'Voicemail') {
          console.log('📼 Redirecting call to voicemail...');
          
          try {
            const attrs = JSON.parse(taskAttributes || '{}');
            const callSid = attrs.call_sid;
            
            if (!callSid) {
              console.error('❌ No call_sid in task attributes');
              break;
            }
            
            // Build voicemail URL
            const url = new URL(req.url);
            const appUrl = `${url.protocol}//${url.host}`;
            const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${WORKSPACE_SID}`;
            
            // Redirect the call to voicemail TwiML
            await client.calls(callSid).update({
              url: voicemailUrl,
              method: 'POST',
            });
            
            console.log('✅ Call redirected to voicemail');
            
            // Cancel the task (voicemail will be handled separately)
            try {
              await client.taskrouter.v1
                .workspaces(WORKSPACE_SID)
                .tasks(taskSid)
                .update({
                  assignmentStatus: 'canceled',
                  reason: 'Redirected to voicemail',
                });
              console.log('✅ Task canceled after voicemail redirect');
            } catch {
              // Task may already be canceled - that's fine
              console.log('ℹ️ Task already canceled or completed');
            }
          } catch (err) {
            console.error('❌ Failed to redirect to voicemail:', err);
          }
        }
        break;

      case 'reservation.created':
        console.log(`🔔 Reservation created for worker: ${workerSid}`);
        break;

      case 'reservation.accepted':
        console.log(`✅ Reservation accepted by worker: ${workerSid}`);
        break;

      case 'reservation.rejected':
        console.log(`🚫 Reservation rejected by worker: ${workerSid}`);
        break;

      case 'reservation.timeout':
        console.log(`⏰ Reservation timeout for worker: ${workerSid}`);
        break;

      case 'task.canceled':
        console.log('🗑️ Task canceled');
        console.log(
          'Reason:',
          formData.get('TaskCanceledReason') || 'unknown'
        );
        break;

      default:
        console.log('ℹ️ Unhandled event type');
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ TaskRouter event callback error:', error);
    return new Response(null, { status: 500 });
  }
}

