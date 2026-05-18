/**
 * Client Status Callback — Simultaneous Ring
 *
 * Fired by Twilio for every status change on the <Client> noun leg inside
 * the simultaneous-dial <Dial>. When the browser client rejects or dismisses
 * the call (CallStatus = "no-answer" | "canceled" | "busy"), this handler
 * immediately cancels the outbound cell phone leg via the REST API so it
 * stops ringing instead of waiting for the full 20s timeout.
 *
 * When the browser client answers (CallStatus = "answered"), this handler
 * switches the worker to Busy in TaskRouter so they move to the back of the
 * round-robin queue. post_work_activity_sid in the assignment callback
 * automatically switches them back to Available when the call ends.
 *
 * Query parameters (set by simultaneous-dial/route.ts):
 *   cellPhone  — E.164 cell number to cancel
 *   taskSid    — TaskRouter Task SID (for logging)
 *   workerSid  — TaskRouter Worker SID (for activity switch)
 */

import twilio from 'twilio';

const ACCOUNT_SID       = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN        = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID     = process.env.TASKROUTER_WORKSPACE_SID!;
const BUSY_ACTIVITY_SID = process.env.TASKROUTER_ACTIVITY_BUSY_SID!;

export async function POST(req: Request) {
  try {
    const url       = new URL(req.url);
    const cellPhone = url.searchParams.get('cellPhone');
    const taskSid   = url.searchParams.get('taskSid');
    const workerSid = url.searchParams.get('workerSid');

    const formData   = await req.formData();
    const callStatus = formData.get('CallStatus') as string | null;
    const callSid    = formData.get('CallSid')    as string | null;

    console.log('═══════════════════════════════════════════');
    console.log('📱 CLIENT STATUS CALLBACK');
    console.log('CallStatus:', callStatus);
    console.log('CallSid:',    callSid);
    console.log('TaskSid:',    taskSid);
    console.log('WorkerSid:',  workerSid);
    console.log('CellPhone:',  cellPhone?.replace(/\d(?=\d{4})/g, '*'));
    console.log('═══════════════════════════════════════════');

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

    // ── Worker answered — switch to Busy for true round-robin ────────────────
    if (callStatus === 'answered' && workerSid && WORKSPACE_SID && BUSY_ACTIVITY_SID) {
      console.log(`✅ Browser leg answered — switching worker ${workerSid} to Busy`)
      try {
        await client.taskrouter.v1
          .workspaces(WORKSPACE_SID)
          .workers(workerSid)
          .update({ activitySid: BUSY_ACTIVITY_SID })
        console.log(`✅ Worker ${workerSid} switched to Busy`)
      } catch (err) {
        console.error('❌ Failed to switch worker to Busy:', err)
      }
    }

    // ── Browser leg ended without answering — cancel cell leg ────────────────
    const browserRejected =
      callStatus === 'no-answer' ||
      callStatus === 'canceled'  ||
      callStatus === 'busy';

    if (browserRejected && cellPhone) {
      console.log(`🚫 Browser leg "${callStatus}" — canceling cell leg to ${cellPhone.replace(/\d(?=\d{4})/g, '*')}`);

      // Find all active outbound calls to the cell number and cancel them.
      // We filter by `to` and `status=ringing` to avoid touching unrelated calls.
      const activeCalls = await client.calls.list({
        to:     cellPhone,
        status: 'ringing',
      });

      console.log(`   Found ${activeCalls.length} ringing call(s) to cell`);

      await Promise.all(
        activeCalls.map(call =>
          client.calls(call.sid)
            .update({ status: 'canceled' })
            .then(() => console.log(`   ✅ Canceled cell leg ${call.sid}`))
            .catch((err: Error) => console.error(`   ❌ Failed to cancel ${call.sid}:`, err.message))
        )
      );
    } else if (!browserRejected && callStatus !== 'answered') {
      console.log(`ℹ️ CallStatus="${callStatus}" — no action needed`);
    }

    // Always return 204 — Twilio doesn't need TwiML from a statusCallback
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Client status callback error:', error);
    return new Response(null, { status: 500 });
  }
}