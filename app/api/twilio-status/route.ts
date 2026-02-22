/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - Cell answers (in-progress): redirect caller into conference, complete task, cancel GPP2
 * - Cell still ringing but GPP2 answered: cancel cell leg
 *
 * For AMD detection (type=simring-amd):
 * - Voicemail detected: cancel the cell leg so caller rolls to next agent
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

    // Signature validation — log only, not blocking
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
      const { pathname, search } = new URL(req.url);
      const fullUrl = `${proto}://${host}${pathname}${search}`;
      const params: Record<string, string> = {};
      new URLSearchParams(bodyText).forEach((value, key) => (params[key] = value));
      const isValid = twilio.validateRequest(TWILIO_AUTH_TOKEN, twilioSignature, fullUrl, params);
      if (!isValid) {
        console.error('❌ Invalid Twilio signature on twilio-status (not blocking)');
      }
    }

    const CallSid = formData.get('CallSid') as string;
    const CallStatus = formData.get('CallStatus') as string;
    const AnsweredBy = formData.get('AnsweredBy') as string;
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
      AnsweredBy: AnsweredBy || undefined,
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
      From,
      To,
      Timestamp,
      callType: callType || 'standard',
    });

    const client = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

    // ─────────────────────────────────────────────────────────────
    // AMD CALLBACK — voicemail detected, cancel cell leg
    // ─────────────────────────────────────────────────────────────
    if (callType === 'simring-amd') {
      if (AnsweredBy === 'machine_start' || AnsweredBy === 'machine_end_beep' || AnsweredBy === 'machine_end_silence') {
        console.log(`🤖 Voicemail detected (${AnsweredBy}) — canceling cell leg: ${CallSid}`);
        try {
          await client.calls(CallSid).update({ status: 'canceled' });
          console.log(`✅ Cell leg canceled — caller will roll to next agent`);
        } catch (err) {
          console.warn(`⚠️ Could not cancel cell leg:`, (err as Error).message);
        }
      } else {
        console.log(`👤 Human answered (${AnsweredBy}) — no action needed`);
      }
      return new Response(null, { status: 204 });
    }

    // ─────────────────────────────────────────────────────────────
    // SIMULTANEOUS RING cell leg handling
    // ─────────────────────────────────────────────────────────────
    if (callType === 'simring-cell' && conferenceName) {

      // ── Cell answered ──
      if (CallStatus === 'in-progress') {
        console.log(`📱 Cell answered - bridging caller into conference: ${conferenceName}`);

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

        if (contactUri) {
          try {
            console.log(`🔍 Looking for ringing GPP2 call to: ${contactUri}`);
            const ringingCalls = await client.calls.list({ to: contactUri, status: 'ringing' });
            if (ringingCalls.length > 0) {
              for (const call of ringingCalls) {
                try {
                  await client.calls(call.sid).update({ status: 'canceled' });
                  console.log(`✅ GPP2 call ${call.sid} canceled`);
                } catch (err) {
                  console.warn(`⚠️ Could not cancel GPP2 call:`, (err as Error).message);
                }
              }
            } else {
              console.log('ℹ️ No ringing GPP2 calls found');
            }
          } catch (err) {
            console.error('❌ Failed to cancel GPP2 call:', (err as Error).message);
          }
        }
      }

      // ── Cell still ringing but GPP2 already answered ──
      if (CallStatus === 'initiated' || CallStatus === 'ringing') {
        try {
          const conferences = await client.conferences.list({
            friendlyName: conferenceName,
            status: 'in-progress',
            limit: 1,
          });
          if (conferences.length > 0) {
            const participants = await client.conferences(conferences[0].sid).participants.list();
            if (participants.length >= 2) {
              console.log(`📵 GPP2 already answered — canceling cell leg ${CallSid}`);
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