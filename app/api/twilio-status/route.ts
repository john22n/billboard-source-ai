/**
 * Twilio Call Status Callback
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - Cell answers (in-progress): bridge caller into conference, cancel app ringing
 * - Cell still ringing but GPP2 answered: cancel cell leg
 * - Cell declined/no-answer: reject reservation so app stops ringing
 * - Cell hangs up mid-call (completed, duration > 0): end conference so app disconnects
 *
 * For AMD detection (type=simring-amd):
 * - Voicemail detected: cancel cell leg so caller rolls to next agent
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

// ── Raw Twilio REST helpers (avoids SDK TypeScript overload issues) ──────────
const twilioAuth = () =>
  'Basic ' + Buffer.from(`${ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

async function twilioGet(path: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/${path}`,
    { headers: { Authorization: twilioAuth() } }
  );
  return res.json();
}

async function twilioPost(path: string, body: Record<string, string>) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: twilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    }
  );
  return res.json();
}

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

    const CallSid       = formData.get('CallSid') as string;
    const CallStatus    = formData.get('CallStatus') as string;
    const AnsweredBy    = formData.get('AnsweredBy') as string;
    const CallDuration  = formData.get('CallDuration') as string;
    const From          = formData.get('From') as string;
    const To            = formData.get('To') as string;
    const Timestamp     = formData.get('Timestamp') as string;

    const url           = new URL(req.url);
    const callType      = url.searchParams.get('type');
    const conferenceName = url.searchParams.get('conferenceName');
    const callerCallSid = url.searchParams.get('callerCallSid');
    const contactUri    = url.searchParams.get('contactUri');
    const taskSid       = url.searchParams.get('taskSid');
    const workspaceSid  = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const workerSid     = url.searchParams.get('workerSid');
    const reservationSid = url.searchParams.get('reservationSid');

    console.log(`📊 Call status update: ${CallStatus}`, {
      CallSid, CallStatus,
      AnsweredBy: AnsweredBy || undefined,
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
      From, To, Timestamp,
      callType: callType || 'standard',
    });

    const client = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

    // ─────────────────────────────────────────────────────────────
    // AMD CALLBACK — voicemail detected, cancel cell leg
    // ─────────────────────────────────────────────────────────────
    if (callType === 'simring-amd') {
      if (
        AnsweredBy === 'machine_start' ||
        AnsweredBy === 'machine_end_beep' ||
        AnsweredBy === 'machine_end_silence'
      ) {
        console.log(`🤖 Voicemail detected (${AnsweredBy}) — canceling cell leg: ${CallSid}`);
        try {
          await twilioPost(`Calls/${CallSid}.json`, { Status: 'canceled' });
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

      // ── Cell answered — bridge caller in, cancel app ringing ──
      if (CallStatus === 'in-progress') {
        console.log(`📱 Cell answered — bridging caller into conference: ${conferenceName}`);

        // Redirect caller into the conference — use SDK here (raw fetch has casing issues)
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

        // Complete the task in TaskRouter
        if (taskSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .update({ assignmentStatus: 'completed', reason: 'Answered on cell phone' });
            console.log(`✅ Task ${taskSid} completed`);
          } catch (err) {
            console.error('❌ Failed to complete task:', (err as Error).message);
          }
        }

        // ✅ Cancel any ringing GPP2 app calls using raw fetch (avoids SDK type issues)
        if (contactUri) {
          try {
            console.log(`🔍 Looking for active app calls to: ${contactUri}`);
            const callsData = await twilioGet(
              `Calls.json?To=${encodeURIComponent(contactUri)}&PageSize=10`
            );
            const appCalls = (callsData.calls || []).filter(
              (c: { sid: string; status: string }) =>
                ['initiated', 'ringing', 'in-progress'].includes(c.status) &&
                c.sid !== CallSid
            );
            if (appCalls.length > 0) {
              for (const call of appCalls as Array<{ sid: string; status: string }>) {
                try {
                  const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';
                  await twilioPost(`Calls/${call.sid}.json`, { Status: newStatus });
                  console.log(`✅ App call ${call.sid} ${newStatus} — app will stop ringing`);
                } catch (err) {
                  console.warn(`⚠️ Could not cancel app call:`, (err as Error).message);
                }
              }
            } else {
              console.log('ℹ️ No active app calls found to cancel');
            }
          } catch (err) {
            console.error('❌ Failed to cancel app calls:', (err as Error).message);
          }
        }
      }

      // ── Cell still ringing but GPP2 already answered — cancel cell ──
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
              console.log(`📵 GPP2 already answered — canceling cell leg ${CallSid}`);
              await twilioPost(`Calls/${CallSid}.json`, { Status: 'canceled' });
            }
          }
        } catch (err) {
          console.warn('⚠️ Simring cleanup failed:', (err as Error).message);
        }
      }

      // ── Cell hung up mid-call (answered then hung up) — end the conference ──
      // duration > 0 means they actually answered and then ended the call
      if (CallStatus === 'completed' && CallDuration && parseInt(CallDuration) > 0) {
        console.log(`📵 Cell hung up mid-call (duration: ${CallDuration}s) — ending conference`);
        try {
          // Find the active conference and end it so the app disconnects too
          const conferences = await client.conferences.list({
            friendlyName: conferenceName,
            status: 'in-progress',
            limit: 1,
          });
          if (conferences.length > 0) {
            await client.conferences(conferences[0].sid).update({ status: 'completed' });
            console.log(`✅ Conference ${conferences[0].sid} ended — app will disconnect`);
          } else {
            console.log('ℹ️ No active conference found — already ended');
          }
        } catch (err) {
          console.error('❌ Failed to end conference:', (err as Error).message);
        }

        // Also complete the task
        if (taskSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .update({ assignmentStatus: 'completed', reason: 'Cell phone hung up' });
            console.log(`✅ Task ${taskSid} completed`);
          } catch (err) {
            const msg = (err as Error).message || '';
            if (!msg.includes('already') && !msg.includes('completed')) {
              console.error('❌ Failed to complete task:', msg);
            }
          }
        }
      }

      // ── Cell declined or no-answer — reject reservation so app stops ringing ──
      if (
        CallStatus === 'no-answer' ||
        CallStatus === 'busy' ||
        (CallStatus === 'canceled' && (!CallDuration || CallDuration === '0')) ||
        (CallStatus === 'completed' && (!CallDuration || CallDuration === '0'))
      ) {
        console.log(`📵 Cell declined/no-answer (${CallStatus}) — rejecting reservation to stop app ringing`);

        if (reservationSid && workspaceSid && workerSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .workers(workerSid)
              .reservations(reservationSid)
              .update({ reservationStatus: 'rejected' });
            console.log(`✅ Reservation ${reservationSid} rejected — app will stop ringing`);
          } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('already') || msg.includes('completed') || msg.includes('accepted')) {
              console.log(`ℹ️ Reservation ${reservationSid} already resolved — no action needed`);
            } else {
              console.error('❌ Failed to reject reservation:', msg);
            }
          }
        } else {
          console.warn(`⚠️ Cannot reject reservation — missing params:`, { reservationSid, workspaceSid, workerSid });
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}