/**
 * Twilio Call Status Callback
 *
 * Primary handler for cell call lifecycle events (simring-cell type).
 * Owns all cell-related cleanup so we don't rely on conference events for it.
 *
 * Cell answered (in-progress) → kick browser from conference
 * Cell hung up (completed, duration > 0) → remove remaining conference participants + complete task
 * Cell never answered (no-answer / busy / completed duration=0) → complete task + re-enqueue caller
 * Cell canceled → no action (browser answered first, call-complete handled it)
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

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

/**
 * Find the conference by friendly name and remove all participants except the one
 * we want to keep (the cell itself). Used when cell answers to kick the browser.
 */
async function kickBrowserFromConference(
  client: ReturnType<typeof twilio>,
  conferenceName: string,
  keepCallSid: string // the cell's own callSid — don't kick itself
) {
  try {
    const conferences = await client.conferences.list({
      friendlyName: conferenceName,
      status: 'in-progress',
      limit: 1,
    });

    if (conferences.length === 0) {
      console.warn(`⚠️ No in-progress conference found for: ${conferenceName}`);
      return;
    }

    const conferenceSid = conferences[0].sid;
    const participants = await client.conferences(conferenceSid).participants.list();
    console.log(`📋 Conference ${conferenceSid} has ${participants.length} participant(s)`);

    for (const p of participants) {
      if (p.callSid === keepCallSid) continue; // don't kick the cell itself
      try {
        await client.conferences(conferenceSid).participants(p.callSid).remove();
        console.log(`✅ Kicked browser/agent leg ${p.callSid} from conference`);
      } catch (err) {
        // Fallback: cancel the call directly
        console.warn(`⚠️ remove() failed for ${p.callSid}, canceling call directly:`, (err as Error).message);
        try {
          await client.calls(p.callSid).update({ status: 'completed' });
          console.log(`✅ Canceled browser call ${p.callSid} directly`);
        } catch (e) {
          console.error(`❌ Failed to cancel browser call ${p.callSid}:`, (e as Error).message);
        }
      }
    }
  } catch (err) {
    console.error(`❌ kickBrowserFromConference failed:`, (err as Error).message);
  }
}

/**
 * Find the conference by friendly name and remove all remaining participants.
 * Used when the cell hangs up to clean up the caller and any other legs.
 */
async function removeAllConferenceParticipants(
  client: ReturnType<typeof twilio>,
  conferenceName: string
) {
  try {
    const conferences = await client.conferences.list({
      friendlyName: conferenceName,
      status: 'in-progress',
      limit: 1,
    });

    if (conferences.length === 0) {
      console.log(`ℹ️ No active conference found for ${conferenceName} — already ended`);
      return;
    }

    const conferenceSid = conferences[0].sid;
    const participants = await client.conferences(conferenceSid).participants.list();
    console.log(`📋 Removing ${participants.length} remaining participant(s) from ${conferenceSid}`);

    for (const p of participants) {
      try {
        await client.conferences(conferenceSid).participants(p.callSid).remove();
        console.log(`✅ Removed participant ${p.callSid}`);
      } catch (err) {
        console.warn(`⚠️ remove() failed for ${p.callSid}, canceling directly:`, (err as Error).message);
        try {
          await client.calls(p.callSid).update({ status: 'completed' });
        } catch (e) {
          console.error(`❌ Failed to cancel call ${p.callSid}:`, (e as Error).message);
        }
      }
    }
  } catch (err) {
    console.error(`❌ removeAllConferenceParticipants failed:`, (err as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

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

    const url            = new URL(req.url);
    const callType       = url.searchParams.get('type');
    const conferenceName = url.searchParams.get('conferenceName');
    const reservationSid = url.searchParams.get('reservationSid');
    const callerCallSid  = url.searchParams.get('callerCallSid');
    const taskSid        = url.searchParams.get('taskSid');
    const workspaceSid   = url.searchParams.get('workspaceSid') || WORKSPACE_SID;

    const duration = parseInt(CallDuration || '0');

    // ✅ FIX: Get conferenceName and callerCallSid from cache if needed (more reliable)
    let cachedConferenceName = conferenceName;
    let cachedCallerCallSid = callerCallSid;
    if (reservationSid) {
      const { getSimringContext } = await import('@/lib/simring-cache');
      const cached = await getSimringContext(reservationSid);
      if (cached) {
        cachedConferenceName = cached.conferenceName;
        cachedCallerCallSid = cached.callerCallSid;
      }
    }

    console.log(`📊 [twilio-status] ${CallStatus} | type=${callType} | CallSid=${CallSid} | duration=${duration}s`);

    const client = twilio(ACCOUNT_SID, TWILIO_AUTH_TOKEN!);

    // ─────────────────────────────────────────────────────────────────────────
    // SIMULTANEOUS RING — cell leg events
    // ─────────────────────────────────────────────────────────────────────────
    if (callType === 'simring-cell' && cachedConferenceName) {

      // ── Cell answered → kick browser from conference ──────────────────────
      // Agent picked up their cell and is hearing the screening prompt.
      // The browser leg is sitting idle in the conference. Kick it now so
      // that if the agent presses 1, only cell + caller end up connected.
      // (cell-screening also kicks on press-1 as a redundant safety net)
      if (CallStatus === 'in-progress') {
        console.log(`📱 Cell answered (in-progress) — kicking browser from conference: ${cachedConferenceName}`);
        await kickBrowserFromConference(client, cachedConferenceName, CallSid);
      }

      // ── Cell hung up after being connected (duration > 0) ─────────────────
      // Agent hung up on their cell. Remove any remaining participants from the
      // conference (caller, if still connected) and complete the task.
      if (CallStatus === 'completed' && duration > 0) {
        console.log(`📵 Cell hung up after ${duration}s — cleaning up conference and completing task`);
        await removeAllConferenceParticipants(client, cachedConferenceName);
        if (taskSid) {
          await completeTaskIfActive(client, taskSid, workspaceSid, 'Cell agent hung up');
        }
      }

      // ── Cell canceled → browser answered first, call-complete handled it ──
      if (CallStatus === 'canceled') {
        console.log(`ℹ️ Cell canceled (browser answered first) — no action needed`);
        return new Response(null, { status: 204 });
      }

      // ── Cell never answered (rang out, voicemail timed out, busy) ─────────
      if (
        CallStatus === 'no-answer' ||
        CallStatus === 'busy' ||
        (CallStatus === 'completed' && duration === 0)
      ) {
        console.log(`📵 Cell never answered (${CallStatus}) — completing task and re-enqueueing caller`);

        if (taskSid) {
          const taskWasActive = await completeTaskIfActive(
            client, taskSid, workspaceSid, `Cell ${CallStatus} — re-enqueueing`
          );
          if (!taskWasActive) {
            console.log(`ℹ️ Task already resolved — skipping re-enqueue`);
            return new Response(null, { status: 204 });
          }
        }

        if (cachedCallerCallSid) {
          try {
            const { protocol, host } = new URL(req.url);
            const inboundUrl = `${protocol}//${host}/api/twilio-inbound`;
            const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${inboundUrl}</Redirect></Response>`;
            await client.calls(cachedCallerCallSid).update({ twiml: requeueTwiml });
             console.log(`✅ Caller ${cachedCallerCallSid} re-enqueued`);
          } catch (err) {
            console.error('❌ Failed to re-enqueue caller:', (err as Error).message);
          }
        } else {
          console.warn(`⚠️ No cachedCallerCallSid — cannot re-enqueue caller`);
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}