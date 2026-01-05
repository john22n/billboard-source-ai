/**
 * TaskRouter Assignment Callback
 * 
 * Called when TaskRouter needs to assign a task to a worker.
 * Uses redirect + custom TwiML to pass original caller number to browser.
 */

import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // Validate Twilio signature
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
      }
    }

    const taskSid = formData.get('TaskSid') as string;
    const reservationSid = formData.get('ReservationSid') as string;
    const workerSid = formData.get('WorkerSid') as string;
    const workerAttributes = formData.get('WorkerAttributes') as string;
    const taskAttributes = formData.get('TaskAttributes') as string;
    const workspaceSid = formData.get('WorkspaceSid') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📋 TASKROUTER ASSIGNMENT CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('TaskSid:', taskSid);
    console.log('ReservationSid:', reservationSid);
    console.log('WorkerSid:', workerSid);

    let workerAttrs: { email?: string; contact_uri?: string } = {};
    let taskAttrs: { call_sid?: string; from?: string; to?: string } = {};

    try {
      workerAttrs = JSON.parse(workerAttributes || '{}');
      taskAttrs = JSON.parse(taskAttributes || '{}');
    } catch {
      console.error('Failed to parse attributes');
    }

    console.log('Worker email:', workerAttrs.email);
    console.log('Original caller (from):', taskAttrs.from);
    console.log('═══════════════════════════════════════════');

    // Build URLs
    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;

    // Check if this is the voicemail worker
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📼 Voicemail worker assigned');

      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;
      const callSid = taskAttrs.call_sid;
      
      if (!callSid) {
        console.error('❌ No call_sid in task attributes');
        return Response.json({ instruction: 'reject' });
      }

      return Response.json({
        instruction: 'redirect',
        call_sid: callSid,
        url: voicemailUrl,
        accept: true,
        post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      });
    }

    // =========================================================================
    // NORMAL WORKER - Use redirect to pass original caller number
    // =========================================================================
    
    const callSid = taskAttrs.call_sid;
    if (!callSid) {
      console.error('❌ No call_sid in task attributes');
      return Response.json({ instruction: 'reject' });
    }

    const workerIdentity = workerAttrs.email || '';
    const originalCallerNumber = taskAttrs.from || 'Unknown';
    
    // Build URL to our bridge endpoint with the original caller number
    const bridgeUrl = new URL(`${appUrl}/api/taskrouter/bridge-to-worker`);
    bridgeUrl.searchParams.set('worker', workerIdentity);
    bridgeUrl.searchParams.set('originalFrom', originalCallerNumber);
    bridgeUrl.searchParams.set('taskSid', taskSid);
    bridgeUrl.searchParams.set('workspaceSid', workspaceSid);

    console.log('📞 Redirecting to bridge with original caller:', originalCallerNumber);

    const instruction = {
      instruction: 'redirect',
      call_sid: callSid,
      url: bridgeUrl.toString(),
      accept: true,
      post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
    };

    console.log('📞 Redirect instruction:', instruction);
    return Response.json(instruction);

  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}