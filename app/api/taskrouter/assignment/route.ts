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
      }
    }

    const taskSid        = formData.get('TaskSid')        as string;
    const reservationSid = formData.get('ReservationSid') as string;
    const workerSid      = formData.get('WorkerSid')      as string;
    const workerAttributes = formData.get('WorkerAttributes') as string;
    const taskAttributes   = formData.get('TaskAttributes')   as string;

    console.log('═══════════════════════════════════════════');
    console.log('📋 TASKROUTER ASSIGNMENT CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('TaskSid:',        taskSid);
    console.log('ReservationSid:', reservationSid);
    console.log('WorkerSid:',      workerSid);

    let workerAttrs: {
      email?: string;
      contact_uri?: string;
      simultaneous_ring?: boolean;
      cell_phone?: string;
    } = {};
    let taskAttrs: { call_sid?: string; from?: string } = {};

    try {
      workerAttrs = JSON.parse(workerAttributes || '{}');
      taskAttrs   = JSON.parse(taskAttributes   || '{}');
    } catch {
      console.error('Failed to parse attributes');
    }

    console.log('Worker email:', workerAttrs.email);
    console.log('Call from:',   taskAttrs.from);
    console.log('═══════════════════════════════════════════');

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${new URL(req.url).protocol}//${new URL(req.url).host}`
    ).replace(/\/$/, '');
    const workspaceSid = formData.get('WorkspaceSid') as string;

    // ── VOICEMAIL WORKER ─────────────────────────────────────────────────────
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📼 Voicemail worker assigned - using redirect instruction');

      const voicemailUrl = new URL(`${appUrl}/api/taskrouter/voicemail`);
      voicemailUrl.searchParams.set('taskSid',      taskSid);
      voicemailUrl.searchParams.set('workspaceSid', workspaceSid);
      if (process.env.VERCEL_BYPASS_TOKEN) {
        voicemailUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
      }

      const callSid = taskAttrs.call_sid;
      if (!callSid) {
        console.error('❌ No call_sid in task attributes - cannot redirect');
        return Response.json({ instruction: 'reject' });
      }

      const instruction = {
        instruction: 'redirect',
        call_sid:    callSid,
        url:         voicemailUrl.toString(),
        accept:      true,
        post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      };

      console.log('📞 Redirect instruction:', instruction);

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

    // ── SIMULTANEOUS RING ────────────────────────────────────────────────────
    if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {
      console.log('📱 Worker has simultaneous_ring=true — using parallel dial instead of conference');

      const callSid = taskAttrs.call_sid;

      if (!callSid) {
        console.error('❌ No call_sid in task attributes — falling through to conference for simultaneous-ring worker');
      } else {
        const clientIdentity = (workerAttrs.contact_uri ?? `client:${workerAttrs.email}`)
          .replace(/^client:/, '');

        const simDialUrl = new URL(`${appUrl}/api/taskrouter/simultaneous-dial`);
        simDialUrl.searchParams.set('taskSid',        taskSid);
        simDialUrl.searchParams.set('workspaceSid',   workspaceSid);
        simDialUrl.searchParams.set('clientIdentity', clientIdentity);
        simDialUrl.searchParams.set('cellPhone',      workerAttrs.cell_phone);
        simDialUrl.searchParams.set('callerFrom',     taskAttrs.from ?? '');
        simDialUrl.searchParams.set('workerSid',      workerSid);
        if (process.env.VERCEL_BYPASS_TOKEN) {
          simDialUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
        }

        const simRingInstruction = {
          instruction: 'redirect',
          call_sid:    callSid,
          url:         simDialUrl.toString(),
          accept:      true,
          post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
        };

        console.log('📞 Simultaneous ring redirect instruction:', {
          ...simRingInstruction,
          url: simRingInstruction.url.replace(/cellPhone=[^&]+/, 'cellPhone=***'),
        });
        return Response.json(simRingInstruction);
      }
    }
    // ── END SIMULTANEOUS RING ────────────────────────────────────────────────

    // ── NORMAL CONFERENCE ────────────────────────────────────────────────────
    const callCompleteUrl = new URL(`${appUrl}/api/taskrouter/call-complete`);
    callCompleteUrl.searchParams.set('taskSid',      taskSid);
    callCompleteUrl.searchParams.set('workspaceSid', workspaceSid);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      callCompleteUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    const instruction = {
      instruction: 'conference',
      to:   workerAttrs.contact_uri || `client:${workerAttrs.email}`,
      from: taskAttrs.from || process.env.TWILIO_MAIN_NUMBER || '+18338547126',
      post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      timeout: 20,
      conference_status_callback:       callCompleteUrl.toString(),
      conference_status_callback_event: 'start, end, join, leave',
      end_conference_on_exit:           true,
      end_conference_on_customer_exit:  true,
      reject_pending_reservations:      true,
    };

    console.log('📞 Conference instruction:', instruction);

    return Response.json(instruction);
  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}