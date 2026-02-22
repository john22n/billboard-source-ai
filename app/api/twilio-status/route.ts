/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - Cell answers (in-progress): accept the reservation with a conference
 *   instruction pointing to the named room so the caller gets dequeued
 *   into that conference. Then cancel the GPP2 leg.
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
      // Accept the reservation with a conference instruction pointing to
      // the named room — this dequeues the caller into that conference.
      // Then cancel the GPP2 leg so it stops ringing.
      if (CallStatus === 'in-progress' && reservationSid && taskSid) {
        console.log(`📱 Cell answered - bridging caller into conference: ${conferenceName}`);
        try {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .reservations(reservationSid)
            .update({
              reservationStatus: 'accepted',
              instruction: 'conference',
              conferenceFriendlyName: conferenceName,
              endConferenceOnExit: true,
              postWorkActivitySid: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID,
            }as any);
          console.log(`✅ Caller dequeued into conference via cell answer`);

          // Now cancel the GPP2 leg — find it in the conference
          // Give Twilio a moment to update conference state
          await new Promise((resolve) => setTimeout(resolve, 1000));

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
              if (participant.callSid !== CallSid) {
                console.log(`📵 Canceling GPP2 leg: ${participant.callSid}`);
                try {
                  await client.calls(participant.callSid).update({ status: 'canceled' });
                } catch (err) {
                  console.warn(`⚠️ Could not cancel GPP2 leg:`, (err as Error).message);
                }
              }
            }
          } else {
            console.log('ℹ️ Conference not yet in-progress when trying to cancel GPP2');
          }
        } catch (err) {
          console.error('❌ Failed to bridge caller on cell answer:', (err as Error).message);
        }
      }

      // ── Cell still ringing but GPP2 already answered ──
      // Conference is already in-progress with 2+ participants — cancel cell
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