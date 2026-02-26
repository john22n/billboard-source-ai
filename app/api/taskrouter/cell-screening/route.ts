/**
 * Cell Screening Handler
 *
 * Called by Twilio when the agent presses a digit on their cell phone
 * or when the <Gather> times out (no input — voicemail or ignored).
 *
 * Press 1 → accept: bridge caller into conference, return TwiML to join conference
 * Press 2 → decline: complete task + re-enqueue caller to next agent, hangup cell
 * No input → same as decline: voicemail/no-answer, re-enqueue caller
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function completeTask(taskSid: string, workspaceSid: string, reason: string) {
  try {
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .update({ assignmentStatus: 'completed', reason });
    console.log(`✅ Task ${taskSid} completed (${reason})`);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('not currently assigned') || msg.includes('already')) {
      console.log(`ℹ️ Task ${taskSid} already resolved — skipping`);
    } else {
      console.error(`❌ Failed to complete task: ${msg}`);
    }
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const digit = formData.get('Digits') as string;

    const url = new URL(req.url);
    const conferenceName = url.searchParams.get('conferenceName') as string;
    const taskSid        = url.searchParams.get('taskSid') as string;
    const workspaceSid   = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const workerSid      = url.searchParams.get('workerSid') as string;
    const callerCallSid  = url.searchParams.get('callerCallSid') as string;
    const contactUri     = url.searchParams.get('contactUri') as string;
    const noInput        = url.searchParams.get('noInput') === 'true';

    console.log('═══════════════════════════════════════════');
    console.log('📱 CELL SCREENING');
    console.log('Digit:', digit || 'none');
    console.log('NoInput:', noInput);
    console.log('ConferenceName:', conferenceName);
    console.log('TaskSid:', taskSid);
    console.log('CallerCallSid:', callerCallSid);
    console.log('═══════════════════════════════════════════');

    const accepted = digit === '1' && !noInput;

    if (accepted) {
      // ── Agent pressed 1 — ACCEPT ──────────────────────────────────
      console.log(`✅ Agent accepted call — bridging caller into conference: ${conferenceName}`);

      // Bridge the caller into the conference
      if (callerCallSid) {
        try {
          const callerTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false" waitUrl="">${conferenceName}</Conference></Dial></Response>`;
          await client.calls(callerCallSid).update({ twiml: callerTwiml });
          console.log(`✅ Caller ${callerCallSid} bridged into conference`);
        } catch (err) {
          console.error('❌ Failed to bridge caller:', (err as Error).message);
        }
      } else {
        console.warn('⚠️ No callerCallSid — cannot bridge caller');
      }

      // Complete the task — call is now connected
      if (taskSid) {
        await completeTask(taskSid, workspaceSid, 'Answered on cell phone via screening');
      }

      // Return TwiML to join the cell into the conference
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="true"
      beep="false"
      waitUrl="">
      ${conferenceName}
    </Conference>
  </Dial>
</Response>`;

      return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });

    } else {
      // ── Agent pressed 2, pressed nothing, or voicemail timed out — DECLINE ──
      const reason = noInput ? 'No input (voicemail/no-answer)' : `Declined (pressed ${digit})`;
      console.log(`📵 Cell declined — ${reason} — re-enqueueing caller`);

      // Step 1: Complete the task to free the worker back to Available
      if (taskSid) {
        await completeTask(taskSid, workspaceSid, `Cell screening decline — ${reason}`);
      }

      // Step 2: Re-enqueue caller to next available agent
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
        console.warn('⚠️ No callerCallSid — cannot re-enqueue caller');
      }

      // Hang up the cell leg
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;

      return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }
  } catch (error) {
    console.error('❌ Cell screening error:', error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}