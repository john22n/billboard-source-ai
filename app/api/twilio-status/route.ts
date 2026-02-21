/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - If cell answers (in-progress): accept the TaskRouter reservation so
 *   the caller gets bridged into the conference and the GPP2 stops ringing.
 * - If GPP2 already answered (conference has 2+ participants): cancel the
 *   cell leg so it stops ringing.
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // Signature validation
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const webhookUrl = new URL(req.url).toString();
      const params: Record<string, string> = {};
      new URLSearchParams(bodyText).forEach(
        (value, key) => (params[key] = value)
      );
      if (
        !twilio.validateRequest(
          TWILIO_AUTH_TOKEN,
          twilioSignature,
          webhookUrl,
          params
        )
      ) {
        console.error('❌ Invalid Twilio signature');
        return new Response('Forbidden', { status: 403 });
      }
    }

    const CallSid = formData.get('CallSid') as string;
    const CallStatus = formData.get('CallStatus') as string;
    const CallDuration = formData.get('CallDuration') as string;
    const From = formData.get('From') as string;
    const To = formData.get('To') as string;
    const Timestamp = formData.get('Timestamp') as string;

    // Check if this is a simultaneous ring cell leg callback
    const url = new URL(req.url);
    const callType = url.searchParams.get('type');
    const conferenceName = url.searchParams.get('conferenceName');
    const reservationSid = url.searchParams.get('reservationSid');
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;

    console.log(`📊 Call status update: ${CallStatus}`, {
      CallSid,
      CallStatus,
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
      From,
      To,
      Timestamp,
      callType: callType || 'standard',
    });

    // ─────────────────────────────────────────────────────────────
    // SIMULTANEOUS RING cell leg handling
    // ─────────────────────────────────────────────────────────────
    if (callType === 'simring-cell' && conferenceName) {
      const client = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

      // ── Cell answered ──
      // Accept the reservation so TaskRouter bridges the inbound caller
      // into the conference and stops ringing the GPP2
      if (CallStatus === 'in-progress' && reservationSid && taskSid) {
        console.log(`📱 Cell answered - accepting reservation ${reservationSid}`);
        try {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .reservations(reservationSid)
            .update({ reservationStatus: 'accepted' });
          console.log(`✅ Reservation accepted via cell answer`);
        } catch (err) {
          console.error('❌ Failed to accept reservation on cell answer:', (err as Error).message);
        }
      }

      // ── Cell still ringing but GPP2 already answered ──
      // Check if conference already has 2+ participants (GPP2 + caller)
      // and cancel the cell leg if so
      if (CallStatus === 'initiated' || CallStatus === 'ringing') {
        try {
          const conferences = await client.conferences.list({
            friendlyName: conferenceName,
            status: 'in-progress',
            limit: 1,
          });

          if (conferences.length > 0) {
            const participants = await client
              .conferences(conferences[0].sid)
              .participants.list();

            if (participants.length >= 2) {
              console.log(
                `📵 GPP2 already answered (${participants.length} participants) - canceling cell leg ${CallSid}`
              );
              await client.calls(CallSid).update({ status: 'canceled' });
            }
          }
        } catch (err) {
          console.warn('⚠️ Simring status callback cleanup failed:', err);
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}