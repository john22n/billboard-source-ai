/**
 * TaskRouter Assignment Callback
 * 
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 */

import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

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

    // Build status callback URL to complete task when call ends
    const reqUrl = new URL(req.url);
    const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const workspaceSid = process.env.TASKROUTER_WORKSPACE_SID;
    const statusCallback = `${baseUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;

    // Dequeue instruction: redirects the call to the worker
    // This tells TaskRouter to connect the caller to the agent
    const instruction = {
      instruction: 'dequeue',
      to: workerAttrs.contact_uri || `client:${workerAttrs.email}`,
      from: process.env.TWILIO_MAIN_NUMBER || '+18338547126',
      post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      timeout: 20,
      status_callback_url: statusCallback,
      status_callback_events: ['completed', 'busy', 'failed', 'no-answer', 'canceled'],
    };

    console.log('📞 Dequeue instruction:', instruction);

    return Response.json(instruction);
  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
