/**
 * Twilio Call Status Callback
 *
 * With call screening in place, this file is significantly simplified:
 * - AMD block removed entirely — screening handles accept/decline
 * - in-progress: cell picked up to hear screening prompt — just log, no action
 * - no-answer/busy/canceled: cell never answered at all — complete task + re-enqueue
 * - completed duration > 0: check if normal completed call or slow decline
 *
 * Call screening handles the main accept/decline flow via cell-screening route.
 * This file only handles edge cases where screening never got a chance to run
 * (cell rang out, was busy, or got canceled by app answering first).
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

// ── Raw Twilio REST helpers ──────────────────────────────────────────────────
const twilioAuth = () =>
  'Basic ' + Buffer.from(`${ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

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

// Complete task only if still active — returns false if already resolved (dedup guard)
async function completeTaskIfActive(
  client: ReturnType<typeof twilio>,
  taskSid: string,
  workspaceSid: string,
  reason: string
): Promise<boolean> {
  try {
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .update({ assignmentStatus: 'completed', reason });
    console.log(`✅ Task ${taskSid} completed (${reason})`);
    return true;
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('not currently assigned') || msg.includes('already') || msg.includes('Cannot complete')) {
      console.log(`ℹ️ Task ${taskSid} already resolved — skipping`);
      return false;
    }
    console.error(`❌ Failed to complete task: ${msg}`);
    return false;
  }
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
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
      From, To, Timestamp,
      callType: callType || 'standard',
    });

    const client = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

    // ─────────────────────────────────────────────────────────────
    // SIMULTANEOUS RING cell leg status handling
    // Note: accept/decline is now handled by cell-screening route.
    // This handler only covers edge cases where screening never ran.
    // ─────────────────────────────────────────────────────────────
    if (callType === 'simring-cell' && conferenceName) {

      // ── Cell picked up to hear screening prompt — no action needed ──
      // screening handler will fire on digit press or timeout
      if (CallStatus === 'in-progress') {
        console.log(`📱 Cell picked up screening prompt — waiting for digit input`);
      }

      // ── Cell still ringing but app already answered — cancel cell ──
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
              console.log(`📵 App already answered — canceling cell leg ${CallSid}`);
              await twilioPost(`Calls/${CallSid}.json`, { Status: 'canceled' });
            }
          }
        } catch (err) {
          console.warn('⚠️ Simring cleanup failed:', (err as Error).message);
        }
      }

      // ── Cell completed with duration > 0 ──
      // Screening ran — either accepted (task resolved by screening handler)
      // or declined (task resolved by screening handler).
      // Just check task status and skip if already resolved — nothing to do.
      if (CallStatus === 'completed' && CallDuration && parseInt(CallDuration) > 0) {
        console.log(`📵 Cell completed (${CallDuration}s) — checking task status`);
        if (taskSid) {
          try {
            const task = await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .fetch();
            console.log(`📋 Task status: ${task.assignmentStatus}`);
            if (task.assignmentStatus === 'completed' || task.assignmentStatus === 'canceled') {
              console.log(`ℹ️ Task already resolved — screening handler handled this, no action needed`);
            } else {
              // Task still active — screening may have failed, re-enqueue as fallback
              console.log(`⚠️ Task still active after cell completed — completing and re-enqueueing as fallback`);
              await completeTaskIfActive(client, taskSid, workspaceSid, 'Cell completed — fallback re-enqueue');
              if (callerCallSid) {
                const { protocol, host } = new URL(req.url);
                const inboundUrl = `${protocol}//${host}/api/twilio-inbound`;
                const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${inboundUrl}</Redirect></Response>`;
                await client.calls(callerCallSid).update({ twiml: requeueTwiml });
                console.log(`✅ Caller re-enqueued via fallback`);
              }
            }
          } catch (err) {
            console.warn(`⚠️ Could not fetch task status:`, (err as Error).message);
          }
        }
      }

      // ── Cell never answered (rang out, busy, or canceled by app answering) ──
      // Screening never ran — complete task + re-enqueue caller.
      if (
        CallStatus === 'no-answer' ||
        CallStatus === 'busy' ||
        (CallStatus === 'canceled' && (!CallDuration || CallDuration === '0')) ||
        (CallStatus === 'completed' && (!CallDuration || CallDuration === '0'))
      ) {
        // canceled with no duration = app answered first and we canceled the cell — skip
        if (CallStatus === 'canceled') {
          console.log(`ℹ️ Cell canceled (app answered first) — no action needed`);
          return new Response(null, { status: 204 });
        }

        console.log(`📵 Cell never answered (${CallStatus}) — completing task and re-enqueueing`);

        if (taskSid) {
          const taskWasActive = await completeTaskIfActive(
            client, taskSid, workspaceSid, `Cell ${CallStatus} — re-enqueueing`
          );
          if (!taskWasActive) {
            console.log(`ℹ️ Task already resolved — skipping re-enqueue`);
            return new Response(null, { status: 204 });
          }
        }

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