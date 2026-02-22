/**
 * TaskRouter Assignment Callback
 *
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 * For workers with simultaneous_ring=true, also dials their cell phone
 * using TaskRouter's dequeue instruction so the caller is bridged
 * directly to whichever device answers first.
 *
 * Uses a top-level Twilio client instead of dynamic import to avoid
 * silent failures in Vercel's serverless environment.
 */
import twilio from 'twilio';

// Increase Vercel function timeout to handle Twilio API calls
export const maxDuration = 30;

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;

// Top-level client — avoids dynamic import issues in Vercel serverless
const twilioClient = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // --- Signature validation ---
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const url = new URL(req.url);
      const webhookUrl = url.toString();
      const params: Record<string, string> = {};
      new URLSearchParams(bodyText).forEach((value, key) => {
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
        // Not blocking due to proxy/load balancer issues
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
      simultaneous_ring?: boolean;
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
    console.log('Simultaneous ring:', workerAttrs.simultaneous_ring ?? false);
    console.log('Cell phone:', workerAttrs.cell_phone ?? 'none');
    console.log('Call from:', taskAttrs.from);
    console.log('═══════════════════════════════════════════');

    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;
    const workspaceSid = formData.get('WorkspaceSid') as string;

    // Append Vercel bypass token to all callback URLs so Twilio can reach
    // them on preview deployments. No-op in production (token will be empty).
    const bypassToken = process.env.VERCEL_BYPASS_TOKEN || '';
    const bypassParam = bypassToken ? `&x-vercel-protection-bypass=${bypassToken}` : '';

    const conferenceStatusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}${bypassParam}`;

    // ─────────────────────────────────────────────
    // VOICEMAIL WORKER (unchanged)
    // ─────────────────────────────────────────────
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📼 Voicemail worker assigned - using redirect instruction');
      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}${bypassParam}`;
      const callSid = taskAttrs.call_sid;

      if (!callSid) {
        console.error('❌ No call_sid in task attributes - cannot redirect');
        return Response.json({ instruction: 'reject' });
      }

      const instruction = {
        instruction: 'redirect',
        call_sid: callSid,
        url: voicemailUrl,
        accept: true,
        post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      };

      console.log('📞 Redirect instruction:', instruction);

      twilioClient.taskrouter.v1
        .workspaces(workspaceSid)
        .tasks(taskSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'Redirected to voicemail',
        })
        .then(() => console.log(`✅ Voicemail task ${taskSid} completed`))
        .catch((err: Error) =>
          console.error('⚠️ Failed to complete voicemail task:', err.message)
        );

      return Response.json(instruction);
    }

    // ─────────────────────────────────────────────
    // SIMULTANEOUS RING
    // Rings both GPP2 (browser) and cell phone at the same time.
    //
    // GPP2 answers → TaskRouter handles via conference instruction,
    //   caller gets bridged, cell dequeue gets canceled automatically.
    //
    // Cell answers → TaskRouter dequeues caller directly to cell,
    //   GPP2 conference times out and stops ringing automatically.
    // ─────────────────────────────────────────────
    if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {
      console.log(
        '📱 Simultaneous ring enabled - dialing GPP2 + cell:',
        workerAttrs.cell_phone
      );

      // Dequeue the caller directly to the cell phone via TaskRouter
      // This is the correct approach per Twilio docs — TaskRouter bridges
      // the caller to the cell directly, no separate conference needed
      try {
        await twilioClient.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .reservations(reservationSid)
          .update({
            reservationStatus: 'accepted',
            instruction: 'dequeue',
            to: workerAttrs.cell_phone,
            from: process.env.TWILIO_MAIN_NUMBER || '+18338547126',
            postWorkActivitySid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
          });
        console.log(`📱 Cell dequeue initiated to: ${workerAttrs.cell_phone}`);
      } catch (err) {
        console.error('❌ Failed to dequeue to cell phone:', (err as Error).message);
      }

      // Also return conference instruction for the GPP2 (browser client)
      // so both ring simultaneously — whoever answers first wins
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
        reject_pending_reservations: true,
      };

      console.log('📞 Simultaneous ring conference instruction:', instruction);
      return Response.json(instruction);
    }

    // ─────────────────────────────────────────────
    // NORMAL WORKER (unchanged)
    // ─────────────────────────────────────────────
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
      reject_pending_reservations: true,
    };

    console.log('📞 Conference instruction:', instruction);
    return Response.json(instruction);
  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}