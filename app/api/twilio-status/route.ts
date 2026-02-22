/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - Cell answers (in-progress): redirect the inbound caller into the
 *   named conference, complete the task, then cancel the GPP2 ringing call.
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
    const contactUri = url.searchParams.get('contactUri');
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
      // 1. Redirect caller into the named conference
      // 2. Complete the task so TaskRouter stops routing
      // 3. Cancel the GPP2 ringing call directly by contactUri
      if (CallStatus === 'in-progress') {
        console.log(`📱 Cell answered - bridging caller into conference: ${conferenceName}`);

        // Step 1 — Redirect caller into the conference
        if (callerCallSid) {
          try {
            const callerTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" waitUrl="">${conferenceName}</Conference></Dial></Response>`;
            await client.calls(callerCallSid).update({ twiml: callerTwiml });
            console.log(`✅ Caller ${callerCallSid} redirected into conference`);
          } catch (err) {
            console.error('❌ Failed to redirect caller:', (err as Error).message);
          }
        } else {
          console.warn('⚠️ No callerCallSid — cannot bridge caller');
        }

        // Step 2 — Complete the task so TaskRouter stops routing
        if (taskSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .update({
                assignmentStatus: 'completed',
                reason: 'Answered on cell phone',
              });
            console.log(`✅ Task ${taskSid} completed`);
          } catch (err) {
            console.error('❌ Failed to complete task:', (err as Error).message);
          }
        }

        // Step 3 — Cancel the GPP2 ringing call by finding it via contactUri
        if (contactUri) {
          try {
            console.log(`🔍 Looking for ringing GPP2 call to: ${contactUri}`);
            const ringingCalls = await client.calls.list({
              to: contactUri,
              status: 'ringing',
            });

            if (ringingCalls.length > 0) {
              for (const call of ringingCalls) {
                console.log(`📵 Canceling GPP2 ringing call: ${call.sid}`);
                try {
                  await client.calls(call.sid).update({ status: 'canceled' });
                  console.log(`✅ GPP2 call canceled`);
                } catch (err) {
                  console.warn(`⚠️ Could not cancel GPP2 call:`, (err as Error).message);
                }
              }
            } else {
              console.log('ℹ️ No ringing GPP2 calls found — may have already stopped');
            }
          } catch (err) {
            console.error('❌ Failed to find/cancel GPP2 call:', (err as Error).message);
          }
        } else {
          console.warn('⚠️ No contactUri — cannot cancel GPP2 call');
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