/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - Cell answers (in-progress): redirect the inbound caller into the
 *   named conference using their call_sid, then cancel the GPP2 leg.
 * - Cell still ringing but GPP2 already answered: cancel the cell leg.
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

    const url = new URL(req.url);
    const callType = url.searchParams.get('type');
    const conferenceName = url.searchParams.get('conferenceName');
    const callerCallSid = url.searchParams.get('callerCallSid');

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
      // Redirect the inbound caller into the named conference so they
      // connect with the cell. Then cancel the GPP2 leg.
      if (CallStatus === 'in-progress') {
        console.log(`📱 Cell answered - bridging caller into conference: ${conferenceName}`);

        // Redirect caller into the same conference where cell is waiting
        if (callerCallSid) {
          try {
            const callerTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" waitUrl="">${conferenceName}</Conference></Dial></Response>`;
            await client.calls(callerCallSid).update({ twiml: callerTwiml });
            console.log(`✅ Caller ${callerCallSid} redirected into conference: ${conferenceName}`);
          } catch (err) {
            console.error('❌ Failed to redirect caller into conference:', (err as Error).message);
          }
        } else {
          console.warn('⚠️ No callerCallSid available — cannot bridge caller');
        }

        // Cancel the GPP2 leg
        try {
          await new Promise((resolve) => setTimeout(resolve, 1500));

          const conferences = await client.conferences.list({
            friendlyName: conferenceName,
            status: 'in-progress',
            limit: 1,
          });

          if (conferences.length > 0) {
            const participants = await client
              .conferences(conferences[0].sid)
              .participants.list();

            console.log(`👥 Conference participants: ${participants.length}`);

            for (const participant of participants) {
              if (participant.callSid !== CallSid && participant.callSid !== callerCallSid) {
                console.log(`📵 Canceling GPP2 leg: ${participant.callSid}`);
                try {
                  await client.calls(participant.callSid).update({ status: 'canceled' });
                  console.log(`✅ GPP2 leg canceled`);
                } catch (err) {
                  console.warn(`⚠️ Could not cancel GPP2 leg:`, (err as Error).message);
                }
              }
            }
          } else {
            console.log('ℹ️ Conference not in-progress yet — GPP2 will timeout naturally');
          }
        } catch (err) {
          console.error('❌ Failed to cancel GPP2 on cell answer:', (err as Error).message);
        }
      }

      // ── Cell still ringing but GPP2 already answered ──
      // Conference already has 2+ participants — cancel cell leg
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
          console.warn('⚠️ Simring cleanup failed:', (err as Error).message);
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}