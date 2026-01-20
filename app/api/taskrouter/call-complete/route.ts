/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 * Completes the task when the conference ends.
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    // Conference status callback parameters
    const statusCallbackEvent = formData.get('StatusCallbackEvent') as string;
    const conferenceSid = formData.get('ConferenceSid') as string;
    const callSid = formData.get('CallSid') as string;

    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('StatusCallbackEvent:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid:', callSid);
    console.log('TaskSid:', taskSid);
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // Complete the task when the conference ends
    if (statusCallbackEvent === 'conference-end') {
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        // Complete task if it's assigned or wrapping
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
