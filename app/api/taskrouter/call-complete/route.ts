/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 * Completes the task when the conference ends.
 *
 * For simultaneous ring (simring-* conferences):
 * When conference-start fires, GPP2 has answered — cancel the cell leg.
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const statusCallbackEvent = formData.get('StatusCallbackEvent') as string;
    const conferenceSid = formData.get('ConferenceSid') as string;
    const callSid = formData.get('CallSid') as string;
    const conferenceFriendlyName = formData.get('FriendlyName') as string;

    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const cellPhone = url.searchParams.get('cellPhone');

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('StatusCallbackEvent:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid:', callSid);
    console.log('FriendlyName:', conferenceFriendlyName);
    console.log('TaskSid:', taskSid);
    console.log('CellPhone:', cellPhone ?? 'none');
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────
    // SIMULTANEOUS RING: GPP2 answered — cancel the cell leg
    //
    // conference-start fires when the first agent leg answers.
    // For simring conferences, that means GPP2 answered.
    // Cancel the still-ringing cell leg immediately.
    // ─────────────────────────────────────────────────────────────
    if (
      statusCallbackEvent === 'conference-start' &&
      conferenceFriendlyName?.startsWith('simring-') &&
      cellPhone
    ) {
      console.log(`📵 GPP2 answered — canceling cell leg to: ${cellPhone}`);
      try {
        const ringingCalls = await client.calls.list({
          to: cellPhone,
          status: 'ringing',
        });

        if (ringingCalls.length > 0) {
          for (const call of ringingCalls) {
            console.log(`📵 Canceling cell ringing call: ${call.sid}`);
            try {
              await client.calls(call.sid).update({ status: 'canceled' });
              console.log(`✅ Cell leg canceled`);
            } catch (err) {
              console.warn(`⚠️ Could not cancel cell leg:`, (err as Error).message);
            }
          }
        } else {
          console.log('ℹ️ No ringing cell calls found — may have already stopped');
        }
      } catch (err) {
        console.error('❌ Failed to cancel cell leg:', (err as Error).message);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Complete the task when the conference ends (unchanged)
    // ─────────────────────────────────────────────────────────────
    if (statusCallbackEvent === 'conference-end') {
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        if (
          task.assignmentStatus === 'assigned' ||
          task.assignmentStatus === 'wrapping'
        ) {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: 'Conference ended',
            });
          console.log(
            `✅ Task ${taskSid} completed (was ${task.assignmentStatus})`
          );
        } else {
          console.log(
            `ℹ️ Task is ${task.assignmentStatus}, skipping completion`
          );
        }
      } catch (error) {
        console.error('❌ Failed to complete task:', error);
      }
    } else {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}