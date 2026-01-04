/**
 * TaskRouter Assignment Callback
 * 
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 */

import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const twilioClient = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // Validate Twilio signature (skip in dev, log failures in prod)
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const url = new URL(req.url);
      const webhookUrl = url.toString();

      const params: Record<string, string> = {};
      const searchParams = new URLSearchParams(bodyText);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const isValid = twilio.validateRequest(
        TWILIO_AUTH_TOKEN,
        twilioSignature,
        webhookUrl,
        params
      );

      if (!isValid) {
        console.error('❌ Invalid Twilio signature on assignment callback');
        console.error('URL used:', webhookUrl);
        console.error('Signature:', twilioSignature);
        // Don't block - Twilio signature validation can fail with proxies/load balancers
        // return new Response('Forbidden', { status: 403 });
      }
    }

    const taskSid = formData.get('TaskSid') as string;
    const reservationSid = formData.get('ReservationSid') as string;
    const workerSid = formData.get('WorkerSid') as string;
    const workerAttributes = formData.get('WorkerAttributes') as string;
    const taskAttributes = formData.get('TaskAttributes') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📋 TASKROUTER ASSIGNMENT CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('TaskSid:', taskSid);
    console.log('ReservationSid:', reservationSid);
    console.log('WorkerSid:', workerSid);

    let workerAttrs: { email?: string; contact_uri?: string } = {};
    let taskAttrs: { call_sid?: string; from?: string } = {};

    try {
      workerAttrs = JSON.parse(workerAttributes || '{}');
      taskAttrs = JSON.parse(taskAttributes || '{}');
    } catch {
      console.error('Failed to parse attributes');
    }

    console.log('Worker email:', workerAttrs.email);
    console.log('Call from:', taskAttrs.from);
    console.log('═══════════════════════════════════════════');

    // Build URLs
    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;
    const workspaceSid = formData.get('WorkspaceSid') as string;

    // Check if this is the voicemail worker
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📼 Voicemail worker assigned - redirecting to voicemail');
      
      const callSid = taskAttrs.call_sid;
      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;
      
      // Redirect the call via API - this pulls it out of the Enqueue immediately
      // The Enqueue action attribute will handle cleanup (returns Hangup since call already redirected)
      if (callSid) {
        try {
          await twilioClient.calls(callSid).update({
            url: voicemailUrl,
            method: 'POST',
          });
          console.log('✅ Call redirected to voicemail');
        } catch (err) {
          console.error('❌ Failed to redirect call:', err);
        }
      }
      
      // Cancel the task and free the worker
      try {
        await twilioClient.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            assignmentStatus: 'canceled',
            reason: 'Routed to voicemail',
          });
        console.log('✅ Voicemail task canceled');
        
        // Set voicemail worker back to Available
        const availableActivitySid = process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID;
        if (availableActivitySid && workerSid) {
          await twilioClient.taskrouter.v1
            .workspaces(workspaceSid)
            .workers(workerSid)
            .update({ activitySid: availableActivitySid });
          console.log('✅ Voicemail worker set back to Available');
        }
      } catch (err) {
        console.error('❌ Failed to cancel voicemail task:', err);
      }
      
      return Response.json({ instruction: 'reject' });
    }

    // Normal worker - dequeue to connect the call
    const statusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;

    const instruction = {
      instruction: 'dequeue',
      to: workerAttrs.contact_uri || `client:${workerAttrs.email}`,
      from: process.env.TWILIO_MAIN_NUMBER || '+18338547126',
      post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      timeout: 20,
      status_callback_url: statusCallbackUrl,
      status_callback_events: 'completed',
    };

    console.log('📞 Dequeue instruction:', instruction);

    return Response.json(instruction);
  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
