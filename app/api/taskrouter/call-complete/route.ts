/**
 * Call Complete Callback
 * 
 * Called when a conference call to an agent ends.
 * - On 'completed': Complete the task (call was answered and finished)
 * - On 'no-answer', 'busy', 'failed': Reject reservation so TaskRouter tries next target
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    
    const callSid = formData.get('CallSid') as string;
    const callStatus = formData.get('CallStatus') as string;
    
    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;

    console.log('═══════════════════════════════════════════');
    console.log('📞 CALL COMPLETE CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('CallSid:', callSid);
    console.log('CallStatus:', callStatus);
    console.log('TaskSid:', taskSid);
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    try {
      const task = await client.taskrouter.v1
        .workspaces(workspaceSid)
        .tasks(taskSid)
        .fetch();

      // Agent didn't answer - reject reservation so TaskRouter tries next target
      if (['no-answer', 'busy', 'failed'].includes(callStatus)) {
        if (task.assignmentStatus === 'reserved') {
          // Find the pending reservation and reject it
          const reservations = await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .reservations.list({ reservationStatus: 'pending' });

          for (const res of reservations) {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .reservations(res.sid)
              .update({ reservationStatus: 'rejected' });
            console.log(`🚫 Rejected reservation ${res.sid} - agent ${callStatus}`);
          }
        } else {
          console.log(`ℹ️ Task is ${task.assignmentStatus}, not rejecting`);
        }
        return new Response('OK', { status: 200 });
      }

      // Call completed normally - complete the task
      if (callStatus === 'completed' && task.assignmentStatus === 'assigned') {
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            assignmentStatus: 'completed',
            reason: 'Call completed',
          });
        console.log(`✅ Task ${taskSid} completed`);
      }
    } catch (error) {
      console.error('❌ Failed to update task/reservation:', error);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Call complete callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
