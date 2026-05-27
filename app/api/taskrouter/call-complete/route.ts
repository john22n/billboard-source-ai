/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 * Completes the task when the conference ends.
 * If the conference ended without being answered, redirects caller to voicemail.
 * Worker reset is handled by reservation.canceled in events/route.ts.
 */
import twilio from 'twilio';

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const statusCallbackEvent = formData.get('StatusCallbackEvent') as string;
    const conferenceSid       = formData.get('ConferenceSid')       as string;
    const callSid             = formData.get('CallSid')             as string;

    const url          = new URL(req.url);
    const taskSid      = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const workerSid    = url.searchParams.get('workerSid');

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`
    ).replace(/\/$/, '');

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('StatusCallbackEvent:', statusCallbackEvent);
    console.log('ConferenceSid:',       conferenceSid);
    console.log('CallSid:',             callSid);
    console.log('TaskSid:',             taskSid);
    console.log('WorkerSid:',           workerSid);
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    if (statusCallbackEvent === 'conference-end') {
      try {
        const task           = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();
        const taskAttributes = JSON.parse(task.attributes || '{}');
        const callerCallSid  = taskAttributes.call_sid as string | undefined;

        // Complete the task if still active
        if (task.assignmentStatus === 'assigned' || task.assignmentStatus === 'wrapping') {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: 'Conference ended',
            });
          console.log(`✅ Task ${taskSid} completed (was ${task.assignmentStatus})`);
        } else {
          console.log(`ℹ️ Task is ${task.assignmentStatus}, skipping completion`);
        }

        const participants = await client.conferences(conferenceSid)
          .participants
          .list();

        console.log(`📊 Participants count: ${participants.length}`)
        const wasAnswered = participants.length >= 2;
        console.log(`📊 wasAnswered: ${wasAnswered}`)

        if (!wasAnswered && callerCallSid) {
          console.log('📼 Conference ended unanswered — checking if caller is still on the line');
          // Note: worker reset is handled by reservation.canceled in events/route.ts

          const voicemailUrl = new URL(`${appUrl}/api/taskrouter/voicemail`);
          voicemailUrl.searchParams.set('taskSid',      taskSid);
          voicemailUrl.searchParams.set('workspaceSid', workspaceSid);
          if (process.env.VERCEL_BYPASS_TOKEN) {
            voicemailUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
          }

          try {
            const callerCall = await client.calls(callerCallSid).fetch()
            if (callerCall.status === 'in-progress') {
              await client.calls(callerCallSid).update({
                url:    voicemailUrl.toString(),
                method: 'POST',
              });
              console.log(`✅ Caller ${callerCallSid} redirected to voicemail`);
            } else {
              console.log(`ℹ️ Caller already hung up (status: ${callerCall.status}) — skipping voicemail redirect`);
            }
          } catch (redirectErr) {
            console.error('❌ Failed to redirect caller to voicemail:', redirectErr);
          }
        } else if (wasAnswered) {
          console.log('✅ Conference was answered — no voicemail redirect needed');
        } else {
          console.log('⚠️ Conference ended unanswered but no callerCallSid available');
        }

      } catch (error) {
        console.error('❌ Failed to handle conference-end:', error);
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