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
            // ✅ endConferenceOnExit="false" keeps the caller alive in the conference
            // even if the cell hangs up, so we can redirect them to the next agent
            const callerTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false" waitUrl="">${conferenceName}</Conference></Dial></Response>`;
            await client.calls(callerCallSid).update({ twiml: callerTwiml });
            console.log(`✅ Caller ${callerCallSid} redirected into conference`);
          } catch (err) {
            console.error('❌ Failed to redirect caller:', (err as Error).message);
          }
        } else {
          console.warn('⚠️ No callerCallSid — cannot bridge caller');
        }

        // ✅ Do NOT complete the task here — keeping it alive keeps the caller connected.
        // If we complete the task now, TaskRouter drops the caller leg immediately.
        // Task is completed either by call-complete (conference-end) or
        // by the cell-hangup block below when we re-enqueue the caller.
        console.log(`ℹ️ Task ${taskSid} left alive — caller stays connected until cell hangs up`);

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

      // ── Cell hung up mid-call (answered then hung up) — re-enqueue caller ──
      // duration > 0 means they actually answered and then ended the call.
      // Do NOT complete the task — reject the reservation so TaskRouter
      // reassigns to the next available agent and the caller stays in queue.
      if (CallStatus === 'completed' && CallDuration && parseInt(CallDuration) > 0) {
        console.log(`📵 Cell hung up mid-call (duration: ${CallDuration}s) — re-enqueueing caller`);

        // Redirect the caller back to the inbound handler — treated as a fresh call,
        // creates a new TaskRouter task and re-enqueues into the round robin
        if (callerCallSid) {
          try {
            const { protocol, host } = new URL(req.url);
            const inboundUrl = `${protocol}//${host}/api/twilio-inbound`;
            const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${inboundUrl}</Redirect></Response>`;
            await client.calls(callerCallSid).update({ twiml: requeueTwiml });
            console.log(`✅ Caller ${callerCallSid} redirected to /api/twilio-inbound for re-enqueue`);
          } catch (err) {
            console.error('❌ Failed to re-enqueue caller:', (err as Error).message);
          }
        } else {
          console.warn('⚠️ No callerCallSid — cannot re-enqueue caller');
        }

        // ✅ Complete the original task now that caller is being re-enqueued
        // This is safe here because the caller is still connected (endConferenceOnExit=false)
        if (taskSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .update({ assignmentStatus: 'completed', reason: 'Cell phone hung up — re-enqueued' });
            console.log(`✅ Original task ${taskSid} completed`);
          } catch (err) {
            const msg = (err as Error).message || '';
            if (!msg.includes('already') && !msg.includes('completed')) {
              console.error('❌ Failed to complete original task:', msg);
            }
          }
        }
      }


      // ── Cell declined or no-answer — complete the task so app stops ringing ──
      // Reservations are already in 'accepted' state by the time we get here
      // (TaskRouter moves them from pending→accepted when assignment callback fires),
      // so we cannot reject them. Completing the task is the correct way to stop
      // the app ringing and free the worker for the next call.
      if (
        CallStatus === 'no-answer' ||
        CallStatus === 'busy' ||
        (CallStatus === 'canceled' && (!CallDuration || CallDuration === '0')) ||
        (CallStatus === 'completed' && (!CallDuration || CallDuration === '0'))
      ) {
        console.log(`📵 Cell declined/no-answer (${CallStatus}) — completing task to stop app ringing`);

        if (taskSid && workspaceSid) {
          try {
            const task = await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .fetch();

            if (task.assignmentStatus === 'assigned' || task.assignmentStatus === 'wrapping') {
              await client.taskrouter.v1
                .workspaces(workspaceSid)
                .tasks(taskSid)
                .update({ assignmentStatus: 'completed', reason: 'Cell declined — no answer' });
              console.log(`✅ Task ${taskSid} completed — app will stop ringing`);
            } else {
              console.log(`ℹ️ Task already ${task.assignmentStatus} — skipping`);
            }
          } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('already') || msg.includes('completed')) {
              console.log(`ℹ️ Task ${taskSid} already resolved — no action needed`);
            } else {
              console.error('❌ Failed to complete task:', msg);
            }
          }
        } else {
          console.warn(`⚠️ Cannot complete task — missing params:`, { taskSid, workspaceSid });
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}