/**
 * Call Complete Callback
 * 
 * Called when a dequeued call ends (connected call disconnects).
 * Completes the TaskRouter task to release the worker from "wrapping".
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    
    const callSid = formData.get('CallSid') as string;
    const callStatus = formData.get('CallStatus') as string;
    
    // Get taskSid from query params (we'll pass it when setting up the dequeue)
    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || process.env.TASKROUTER_WORKSPACE_SID;

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

    // Complete the task when the call ends
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      try {
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            assignmentStatus: 'completed',
            reason: `Call ${callStatus}`,
          });

        console.log(`✅ Task ${taskSid} completed - worker released`);
      } catch (error) {
        console.error('❌ Failed to complete task:', error);
      }
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Call complete callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
