/**
 * TaskRouter Assignment Callback
 *
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 * For workers with simultaneous_ring=true, also dials their cell phone
 * into the same named conference so they can answer either way.
 * Only rings cell phone if worker is currently in an Available/Online activity.
 *
 * ✅ Call Screening replaces AMD:
 * Cell TwiML uses <Gather> to prompt "Press 1 to accept, press 2 to decline".
 * - Press 1 → cell-screening handler bridges caller into conference
 * - Press 2 or no input → cell-screening handler re-enqueues caller
 * - Voicemail picks up → can't press 1 → timeout → re-enqueues automatically
 * No AMD params needed, no race conditions, no voicemail detection delay.
 *
 * ✅ FIX: XML-escape the screeningBaseUrl before embedding in TwiML.
 * The URL contains multiple & chars for query params — these must be &amp; in XML
 * attribute values, otherwise Twilio's XML parser rejects the TwiML and plays
 * "We are sorry, an application error has occurred" the moment the cell picks up.
 *
 * ✅ FIX: Do NOT complete the voicemail task here. The task is still "reserved"
 * at the time of the assignment callback. It only becomes "assigned" after Twilio
 * processes the redirect instruction with accept: true. Completing it here causes:
 * "Cannot complete task ... because it is not currently assigned."
 * Task completion is handled in /api/taskrouter/voicemail-complete instead.
 */
import twilio from 'twilio';

export const maxDuration = 30;

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;

const twilioClient = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/** Escape & in URLs before embedding them in XML attribute values */
const xmlAttr = (s: string) => s.replace(/&/g, '&amp;');

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const webhookUrl = new URL(req.url).toString();
      const params: Record<string, string> = {};
      new URLSearchParams(bodyText).forEach((value, key) => { params[key] = value; });
      const isValid = twilio.validateRequest(TWILIO_AUTH_TOKEN, twilioSignature, webhookUrl, params);
      if (!isValid) {
        console.error('❌ Invalid Twilio signature on assignment callback');
      }
    }

    const taskSid         = formData.get('TaskSid') as string;
    const reservationSid  = formData.get('ReservationSid') as string;
    const workerSid       = formData.get('WorkerSid') as string;
    const workerAttributes = formData.get('WorkerAttributes') as string;
    const taskAttributes  = formData.get('TaskAttributes') as string;
    const workspaceSid    = formData.get('WorkspaceSid') as string;

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
      taskAttrs   = JSON.parse(taskAttributes || '{}');
    } catch {
      console.error('Failed to parse attributes');
    }

    console.log('Worker email:', workerAttrs.email);
    console.log('Simultaneous ring:', workerAttrs.simultaneous_ring ?? false);
    console.log('Cell phone:', workerAttrs.cell_phone ?? 'none');
    console.log('Call from:', taskAttrs.from);
    console.log('Caller call_sid:', taskAttrs.call_sid ?? 'none');
    console.log('═══════════════════════════════════════════');

    const url      = new URL(req.url);
    const appUrl   = `${url.protocol}//${url.host}`;
    const bypassToken = process.env.VERCEL_BYPASS_TOKEN || '';
    const bypassParam = bypassToken ? `&x-vercel-protection-bypass=${bypassToken}` : '';

    // ─────────────────────────────────────────────
    // VOICEMAIL WORKER
    // ─────────────────────────────────────────────
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📼 Voicemail worker assigned - using redirect instruction');
      const voicemailUrl = `${appUrl}/api/taskrouter/voicemail?taskSid=${taskSid}&workspaceSid=${workspaceSid}${bypassParam}`;
      const callSid = taskAttrs.call_sid;

      if (!callSid) {
        console.error('❌ No call_sid in task attributes - cannot redirect');
        return Response.json({ instruction: 'reject' });
      }

      // ✅ Just return the redirect instruction.
      // accept: true moves the task from reserved → assigned.
      // Task completion is handled in /api/taskrouter/voicemail-complete
      // after the recording finishes — NOT here.
      return Response.json({
        instruction: 'redirect',
        call_sid: callSid,
        url: voicemailUrl,
        accept: true,
        post_work_activity_sid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
      });
    }

    // ─────────────────────────────────────────────
    // SIMULTANEOUS RING
    // ─────────────────────────────────────────────
    if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {

      let isOnline = false;
      try {
        const workerData = await twilioClient.taskrouter.v1
          .workspaces(workspaceSid)
          .workers(workerSid)
          .fetch();

        console.log('👤 Worker current activity:', workerData.activityName);
        isOnline = workerData.activityName === 'Available';

        if (!isOnline) {
          console.log(`⏭️ Worker is "${workerData.activityName}" - skipping cell ring, falling through to browser-only`);
        }
      } catch (err) {
        console.error('⚠️ Failed to fetch worker activity - skipping cell ring:', (err as Error).message);
      }

      if (isOnline) {
        console.log('📱 Simultaneous ring enabled - dialing browser + cell:', workerAttrs.cell_phone);

        const conferenceName  = `simring-${reservationSid}`;
        const contactUri      = workerAttrs.contact_uri || `client:${workerAttrs.email}`;
        const callerCallSid   = taskAttrs.call_sid || '';

        // Build the raw URL (with plain & separators)
        const screeningBaseUrl = `${appUrl}/api/taskrouter/cell-screening?conferenceName=${encodeURIComponent(conferenceName)}&taskSid=${taskSid}&workspaceSid=${workspaceSid}&workerSid=${workerSid}&callerCallSid=${callerCallSid}&contactUri=${encodeURIComponent(contactUri)}${bypassParam}`;

        // ✅ FIX: XML-escape before embedding in TwiML.
        // Every & in the URL must be &amp; inside an XML attribute or text node.
        // Without this, Twilio's XML parser fails immediately when the cell answers,
        // producing "We are sorry, an application error has occurred".
        const screeningUrlXml = xmlAttr(screeningBaseUrl);
        const noInputUrlXml   = xmlAttr(`${screeningBaseUrl}&noInput=true`);

        const cellTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${screeningUrlXml}" method="POST" timeout="10">
    <Say voice="Polly.Matthew">Press 1 to accept</Say>
  </Gather>
  <Redirect method="POST">${noInputUrlXml}</Redirect>
</Response>`;

        console.log('📋 Cell TwiML (first 300 chars):', cellTwiml.slice(0, 300));

        const cellStatusCallback = `${appUrl}/api/twilio-status?type=simring-cell&conferenceName=${encodeURIComponent(conferenceName)}&reservationSid=${reservationSid}&taskSid=${taskSid}&workspaceSid=${workspaceSid}&workerSid=${workerSid}&callerCallSid=${callerCallSid}&contactUri=${encodeURIComponent(contactUri)}${bypassParam}`;

        let cellCallSid = '';
        try {
          const call = await twilioClient.calls.create({
            to: workerAttrs.cell_phone,
            from: process.env.TWILIO_MAIN_NUMBER || '+18338547126',
            twiml: cellTwiml,
            timeout: 20,
            statusCallback: cellStatusCallback,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
          });
          cellCallSid = call.sid;
          console.log(`📱 Cell leg initiated: ${cellCallSid}`);
        } catch (err) {
          console.error('❌ Failed to dial cell phone:', (err as Error).message);
        }

        const conferenceStatusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}&cellCallSid=${cellCallSid}&workerSid=${workerSid}${bypassParam}`;

        const instruction = {
          instruction: 'conference',
          to: contactUri,
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
    }

    // ─────────────────────────────────────────────
    // NORMAL WORKER (browser only)
    // ─────────────────────────────────────────────
    const conferenceStatusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}${bypassParam}`;

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

    console.log('📞 Conference instruction (browser only):', instruction);
    return Response.json(instruction);
  } catch (error) {
    console.error('❌ Assignment callback error:', error);
    return new Response('Error', { status: 500 });
  }
}