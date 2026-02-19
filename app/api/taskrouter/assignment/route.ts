/**
 * TaskRouter Assignment Callback
 *
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 * For workers with simultaneous_ring=true, also dials their cell phone
 * into the same named conference so they can answer either way.
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;

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
    console.log('Call from:', taskAttrs.from);
    console.log('═══════════════════════════════════════════');

    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;
    const workspaceSid = formData.get('WorkspaceSid') as string;
    const conferenceStatusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;

    // ─────────────────────────────────────────────
    // VOICEMAIL WORKER (unchanged)
    // ─────────────────────────────────────────────
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📼 Voicemail worker assigned - using redirect instruction');
      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;
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

      import('twilio').then(({ default: twilioModule }) => {
        const client = twilioModule(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);
        client.taskrouter.v1
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
      });

      return Response.json(instruction);
    }

    // ─────────────────────────────────────────────
    // SIMULTANEOUS RING (McDonald only via worker attribute)
    // Rings both GPP2 (browser) and cell phone at the same time.
    // Both legs join the same named conference — whoever answers first
    // wins; the other leg is kicked in call-complete/route.ts.
    // ─────────────────────────────────────────────
    if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {
      console.log(
        '📱 Simultaneous ring enabled - dialing GPP2 + cell:',
        workerAttrs.cell_phone
      );

      // Unique, deterministic conference name tied to this reservation
      const conferenceName = `simring-${reservationSid}`;

      // Fire-and-forget: dial cell phone into the same named conference room
      import('twilio').then(({ default: twilioModule }) => {
        const client = twilioModule(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

        const cellTwiml = `<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Dial>
              <Conference
                startConferenceOnEnter="true"
                endConferenceOnExit="true"
                beep="false">
                ${conferenceName}
              </Conference>
            </Dial>
          </Response>`;

        client.calls
          .create({
            to: workerAttrs.cell_phone!,
            from: process.env.TWILIO_MAIN_NUMBER || '+18338547126',
            twiml: cellTwiml,
            timeout: 20,
            statusCallback: `${appUrl}/api/twilio-status?type=simring-cell&conferenceName=${encodeURIComponent(conferenceName)}`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
          })
          .then((call) => console.log(`📱 Cell leg initiated: ${call.sid}`))
          .catch((err: Error) =>
            console.error('❌ Failed to dial cell phone:', err.message)
          );
      });

      // Return conference instruction for the GPP2 (browser client)
      // conference_friendly_name pins this leg to the named room
      const instruction = {
        instruction: 'conference',
        to: workerAttrs.contact_uri || `client:${workerAttrs.email}`,
        from: taskAttrs.from || process.env.TWILIO_MAIN_NUMBER || '+18338547126',
        post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
        timeout: 20,
        conference_friendly_name: conferenceName,
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