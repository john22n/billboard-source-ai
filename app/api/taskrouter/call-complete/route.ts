/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 * Completes the task when the conference ends.
 *
 * For simultaneous ring (simring-* conferences):
 * When a participant joins and the count reaches 2, it means one of
 * McDonald's legs (GPP2 or cell) has answered. The third leg still
 * ringing gets kicked so it doesn't keep ringing or hit voicemail.
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

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('StatusCallbackEvent:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid:', callSid);
    console.log('FriendlyName:', conferenceFriendlyName);
    console.log('TaskSid:', taskSid);
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────
    // SIMULTANEOUS RING: Cancel the losing leg when one side answers.
    //
    // Participant count when participant-join fires:
    //   1 = inbound caller just entered (waiting)
    //   2 = one of McDonald's legs answered → kick the still-ringing leg
    //   3 = both legs answered at almost the same time (race condition)
    //       → kick the extra non-customer leg
    //
    // The inbound caller is always the oldest participant (joined first),
    // so we use dateCreated to identify and protect them.
    // ─────────────────────────────────────────────────────────────
    if (
      statusCallbackEvent === 'participant-join' &&
      conferenceFriendlyName?.startsWith('simring-')
    ) {
      try {
        const participants = await client
          .conferences(conferenceSid)
          .participants.list();

        console.log(`👥 Simring conference participants: ${participants.length}`);

        // Need at least 3 participants before there's a leg to kick:
        // inbound caller + answering leg + still-ringing leg
        if (participants.length >= 3) {
          // Protect the inbound caller (oldest participant)
          const oldest = participants.reduce((a, b) =>
            new Date(a.dateCreated) < new Date(b.dateCreated) ? a : b
          );

          // The participant who just triggered this event answered
          // Everyone else who isn't the caller and isn't the answering leg gets kicked
          const toKick = participants.filter(
            (p) => p.callSid !== callSid && p.callSid !== oldest.callSid
          );

          for (const leg of toKick) {
            console.log(`📵 Canceling losing simring leg: ${leg.callSid}`);
            try {
              await client.calls(leg.callSid).update({ status: 'canceled' });
            } catch (err) {
              // Call may have already ended — not a problem
              console.warn(`⚠️ Could not cancel leg ${leg.callSid}:`, err);
            }
          }
        }
      } catch (err) {
        console.error('⚠️ Simring leg cleanup error:', err);
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