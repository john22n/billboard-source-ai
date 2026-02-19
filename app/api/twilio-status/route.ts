/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * If the cell leg is still ringing/initiated but the conference already
 * has enough participants (meaning GPP2 answered), cancel the cell leg
 * immediately so it doesn't ring through to voicemail.
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;

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
    // SIMULTANEOUS RING: Safety net for cell leg cancellation.
    //
    // Primary cancellation happens in call-complete/route.ts via
    // participant-join. This is a backup: if the cell leg fires a
    // status callback while still ringing and the conference already
    // has 2+ participants, we cancel it here to prevent voicemail pickup.
    // ─────────────────────────────────────────────────────────────
    if (
      callType === 'simring-cell' &&
      conferenceName &&
      (CallStatus === 'initiated' || CallStatus === 'ringing')
    ) {
      try {
        const client = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

        const conferences = await client.conferences.list({
          friendlyName: conferenceName,
          status: 'in-progress',
          limit: 1,
        });

        if (conferences.length > 0) {
          const participants = await client
            .conferences(conferences[0].sid)
            .participants.list();

          // 2+ participants = inbound caller + one answering leg already in
          // The cell leg is the odd one out — cancel it
          if (participants.length >= 2) {
            console.log(
              `📵 GPP2 already answered (${participants.length} participants) - canceling cell leg ${CallSid}`
            );
            await client.calls(CallSid).update({ status: 'canceled' });
          }
        }
      } catch (err) {
        // Non-fatal — call-complete will handle cleanup if this fails
        console.warn('⚠️ Simring status callback cleanup failed:', err);
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}