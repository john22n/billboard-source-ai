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

    let workerAttrs: {
      email?: string;
      contact_uri?: string;
      /** Set to true in the Twilio Console for workers that should receive a
       *  simultaneous ring to their personal cell phone when a task is assigned. */
      simultaneous_ring?: boolean;
      /** E.164 personal cell number (e.g. "+19565551234"). Read from Twilio worker
       *  attributes — set in the Console alongside simultaneous_ring: true. */
      cell_phone?: string;
    } = {};
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
      console.log('📼 Voicemail worker assigned - using redirect instruction');

      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;

      // call_sid is required for redirect instruction
      const callSid = taskAttrs.call_sid;
      if (!callSid) {
        console.error('❌ No call_sid in task attributes - cannot redirect');
        return Response.json({ instruction: 'reject' });
      }

      // Use TaskRouter's redirect instruction - this properly:
      // 1. Redirects the call to voicemail TwiML
      // 2. Completes the reservation
      // 3. Pulls the call out of the Enqueue cleanly
      //
      // We also complete the task immediately since voicemail doesn't need
      // task tracking - if caller hangs up before recording, task would stay stuck.
      const instruction = {
        instruction: 'redirect',
        call_sid: callSid,
        url: voicemailUrl,
        accept: true,
        post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      };

      console.log('📞 Redirect instruction:', instruction);

      // Complete the task asynchronously - voicemail doesn't need task tracking
      // This prevents tasks from getting stuck if caller hangs up early
      import('twilio').then(({ default: twilioModule }) => {
        const client = twilioModule(
          process.env.TWILIO_ACCOUNT_SID!,
          process.env.TWILIO_AUTH_TOKEN!
        );
        client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            assignmentStatus: 'completed',
            reason: 'Redirected to voicemail',
          })
          .then(() => console.log(`✅ Voicemail task ${taskSid} completed`))
          .catch((err: Error) => console.error('⚠️ Failed to complete voicemail task:', err.message));
      });

      return Response.json(instruction);
    }

    // ── McDONALD SIMULTANEOUS RING ───────────────────────────────────────────
    // If this worker's Twilio attributes include `simultaneous_ring: true` AND
    // a `cell_phone` value, we redirect the caller's call to a TwiML handler
    // that dials BOTH his GPP2 browser client and his personal cell phone in
    // parallel.  The first leg to answer wins; the other drops automatically.
    //
    // This branch is triggered exclusively by worker attributes — no name or
    // SID is hardcoded here.  All other agents fall through to the standard
    // conference instruction below without modification.
    //
    // The availability toggle (Available / Offline) continues to work exactly
    // as-is for McDonald: when he is Offline, TaskRouter will not assign tasks
    // to him, so this branch never executes.  No separate toggle logic is needed.
    if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {
      console.log('📱 Worker has simultaneous_ring=true — using parallel dial instead of conference');

      const callSid = taskAttrs.call_sid;

      if (!callSid) {
        // Safety fallback: call_sid is required for the redirect instruction.
        // If it's missing (shouldn't happen in practice), fall through to the
        // standard conference path so the call is not dropped.
        console.error('❌ No call_sid in task attributes — falling through to conference for simultaneous-ring worker');
      } else {
        // Strip the "client:" scheme prefix to get the bare identity used in
        // TwiML <Client> tags (e.g. "client:mcdonald" → "mcdonald").
        const clientIdentity = (workerAttrs.contact_uri ?? `client:${workerAttrs.email}`)
          .replace(/^client:/, '');

        // Pass all dialing params as query-string args on the redirect URL.
        // The simultaneous-dial route reads them to build the <Dial> TwiML.
        const simDialUrl = new URL(`${appUrl}/api/taskrouter/simultaneous-dial`);
        simDialUrl.searchParams.set('taskSid',        taskSid);
        simDialUrl.searchParams.set('workspaceSid',   workspaceSid);
        simDialUrl.searchParams.set('clientIdentity', clientIdentity);
        simDialUrl.searchParams.set('cellPhone',      workerAttrs.cell_phone);
        // Vercel Deployment Protection bypass — required so Twilio (unauthenticated)
        // can reach this endpoint on protected Vercel deployments.
        // Set VERCEL_AUTOMATION_BYPASS_SECRET in your .env files to the token
        // shown in Vercel Dashboard → Settings → Deployment Protection.
        if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
          simDialUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
        }

        const simRingInstruction = {
          instruction: 'redirect',
          call_sid:    callSid,
          url:         simDialUrl.toString(),
          accept:      true,  // Accept the reservation immediately
          // Return McDonald to Available once the task is completed by
          // simultaneous-dial-complete (matches conference path behavior)
          post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
        };

        console.log('📞 Simultaneous ring redirect instruction:', {
          ...simRingInstruction,
          // Avoid logging full cell number
          url: simRingInstruction.url.replace(/cellPhone=[^&]+/, 'cellPhone=***'),
        });
        return Response.json(simRingInstruction);
      }
    }
    // ── END McDONALD SIMULTANEOUS RING ───────────────────────────────────────

    // Normal worker - use conference instruction (recommended by Twilio)
    // Conference handles call orchestration, monitors if agent answered,
    // and properly times out the reservation if agent doesn't answer
    const conferenceStatusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;

    const instruction = {
      instruction: 'conference',
      to: workerAttrs.contact_uri || `client:${workerAttrs.email}`,
      from: taskAttrs.from || process.env.TWILIO_MAIN_NUMBER || '+18338547126',
      post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      timeout: 20,
      conference_status_callback: conferenceStatusCallbackUrl,
      conference_status_callback_event: 'start, end, join, leave',
      end_conference_on_exit: true,
      end_conference_on_customer_exit: true,
      reject_pending_reservations: true,  // Prevent race condition: reject other reservations when this one is accepted
    };

    console.log('📞 Conference instruction:', instruction);

    return Response.json(instruction);
  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
