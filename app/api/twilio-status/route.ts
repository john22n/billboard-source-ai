/**
 * Twilio Call Status Callback
 *
 * For simultaneous ring cell legs (type=simring-cell):
 * - Cell answers (in-progress): bridge caller into conference, cancel app ringing
 * - Cell still ringing but GPP2 answered: cancel cell leg
 * - Cell declined/no-answer: complete task + redirect caller to re-enqueue
 * - Cell hangs up mid-call (completed, duration > 0, caller in conference): re-enqueue caller
 * - Cell slow decline (completed, duration > 0, caller NOT in conference): complete task + re-enqueue
 *
 * For AMD detection (type=simring-amd):
 * - Voicemail detected: cancel cell leg, complete task, re-enqueue caller directly
 *   ✅ FIX: Don't rely on follow-up simring-cell canceled callback — it never fires
 *   after an AMD-triggered cancel. Handle everything in the AMD block itself.
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

// ── Raw Twilio REST helpers ──────────────────────────────────────────────────
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

    const CallSid      = formData.get('CallSid') as string;
    const CallStatus   = formData.get('CallStatus') as string;
    const AnsweredBy   = formData.get('AnsweredBy') as string;
    const CallDuration = formData.get('CallDuration') as string;
    const From         = formData.get('From') as string;
    const To           = formData.get('To') as string;
    const Timestamp    = formData.get('Timestamp') as string;

    const url            = new URL(req.url);
    const callType       = url.searchParams.get('type');
    const conferenceName = url.searchParams.get('conferenceName');
    const callerCallSid  = url.searchParams.get('callerCallSid');
    const contactUri     = url.searchParams.get('contactUri');
    const taskSid        = url.searchParams.get('taskSid');
    const workspaceSid   = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const workerSid      = url.searchParams.get('workerSid');
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
    // AMD CALLBACK — voicemail detected
    // ✅ FIX: Re-enqueue caller directly here. The follow-up simring-cell
    // canceled callback never fires after an AMD-triggered cancel, so we
    // cannot rely on it. Handle cancel + task complete + re-enqueue all here.
    // ─────────────────────────────────────────────────────────────
    if (callType === 'simring-amd') {
      if (
        AnsweredBy === 'machine_start' ||
        AnsweredBy === 'machine_end_beep' ||
        AnsweredBy === 'machine_end_silence'
      ) {
        console.log(`🤖 Voicemail detected (${AnsweredBy}) — canceling cell leg: ${CallSid}`);

        // Step 1: Cancel the cell leg
        try {
          await twilioPost(`Calls/${CallSid}.json`, { Status: 'canceled' });
          console.log(`✅ Cell leg canceled`);
        } catch (err) {
          console.warn(`⚠️ Could not cancel cell leg:`, (err as Error).message);
        }

        // Step 2: Complete the task to free the worker back to Available
        if (taskSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .update({ assignmentStatus: 'completed', reason: 'Voicemail detected — re-enqueueing' });
            console.log(`✅ Task ${taskSid} completed`);
          } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('not currently assigned') || msg.includes('already')) {
              console.log(`ℹ️ Task already resolved — skipping`);
            } else {
              console.warn(`⚠️ Failed to complete task:`, msg);
            }
          }
        } else {
          console.warn(`⚠️ No taskSid in AMD callback — cannot complete task`);
        }

        // Step 3: Redirect caller back to inbound to re-enqueue to next available agent
        if (callerCallSid) {
          try {
            const { protocol, host } = new URL(req.url);
            const inboundUrl = `${protocol}//${host}/api/twilio-inbound`;
            const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${inboundUrl}</Redirect></Response>`;
            await client.calls(callerCallSid).update({ twiml: requeueTwiml });
            console.log(`✅ Caller ${callerCallSid} re-enqueued to next agent`);
          } catch (err) {
            console.error('❌ Failed to re-enqueue caller:', (err as Error).message);
          }
        } else {
          console.warn(`⚠️ No callerCallSid in AMD callback — cannot re-enqueue`);
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
        if (callerCallSid) {
          try {
            const callerTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false" waitUrl="">${conferenceName}</Conference></Dial></Response>`;
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

        // Cancel any ringing app calls
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

      // ── Cell completed with duration > 0 ──
      // Could be a genuine mid-call hangup (caller was bridged into conference)
      // OR a slow decline (phone rang for a second or two before declining).
      if (CallStatus === 'completed' && CallDuration && parseInt(CallDuration) > 0) {
        console.log(`📵 Cell call completed (duration: ${CallDuration}s) — checking if caller was bridged into conference`);
        let callerWasInConference = false;
        if (callerCallSid && conferenceName) {
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
              callerWasInConference = participants.some(p => p.callSid === callerCallSid);
              console.log(
                callerWasInConference
                  ? `✅ Caller ${callerCallSid} IS in conference — this was a mid-call hangup`
                  : `ℹ️ Caller ${callerCallSid} NOT in conference — this was a slow decline`
              );
            } else {
              console.log(`ℹ️ No active conference found for "${conferenceName}" — treating as decline`);
            }
          } catch (err) {
            console.warn(`⚠️ Could not check conference participants:`, (err as Error).message);
          }
        }

        if (callerWasInConference && callerCallSid) {
          // Cell answered then hung up mid-call → re-enqueue caller
          console.log(`📵 Cell hung up mid-call — re-enqueueing caller ${callerCallSid}`);
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
          // Cell declined slowly — complete task + re-enqueue caller
          console.log(`ℹ️ Cell declined after ${CallDuration}s — completing task and re-enqueueing caller`);

          if (taskSid) {
            try {
              await client.taskrouter.v1
                .workspaces(workspaceSid)
                .tasks(taskSid)
                .update({ assignmentStatus: 'completed', reason: 'Cell slow decline — re-enqueueing' });
              console.log(`✅ Task ${taskSid} completed`);
            } catch (err) {
              const msg = (err as Error).message || '';
              if (msg.includes('not currently assigned') || msg.includes('already')) {
                console.log(`ℹ️ Task already resolved — skipping`);
              } else {
                console.error('❌ Failed to complete task:', msg);
              }
            }
          }

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
            console.warn(`⚠️ No callerCallSid — cannot re-enqueue caller`);
          }
        }
      }

      // ── Cell declined or no-answer ──
      // ✅ FIX: Reservation is already 'accepted' at this point — cannot reject.
      // Complete the task to free the worker, then redirect caller to re-enqueue.
      if (
        CallStatus === 'no-answer' ||
        CallStatus === 'busy' ||
        (CallStatus === 'canceled' && (!CallDuration || CallDuration === '0')) ||
        (CallStatus === 'completed' && (!CallDuration || CallDuration === '0'))
      ) {
        console.log(`📵 Cell declined/no-answer (${CallStatus}) — completing task and re-enqueueing caller`);

        // Step 1: Complete the task so TaskRouter frees the worker back to Available
        if (taskSid) {
          try {
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .update({ assignmentStatus: 'completed', reason: 'Cell no-answer — re-enqueueing' });
            console.log(`✅ Task ${taskSid} completed`);
          } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('not currently assigned') || msg.includes('already')) {
              console.log(`ℹ️ Task already resolved — skipping`);
            } else {
              console.error('❌ Failed to complete task:', msg);
            }
          }
        }

        // Step 2: Redirect caller back to inbound to re-enqueue to next available agent
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
          console.warn(`⚠️ No callerCallSid — cannot re-enqueue caller`);
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}