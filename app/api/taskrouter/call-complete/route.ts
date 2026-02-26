/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 *
 * ✅ FIX: Removed conference-start cancel-cell logic.
 * With call screening, the browser ALWAYS joins the conference first (via assignment
 * instruction), so conference-start fires immediately — BEFORE the agent can press
 * any digit. Canceling the cell at conference-start killed the screening flow.
 *
 * New event responsibilities:
 * - conference-start:   Log only — cell screening handles accept/decline
 * - participant-leave:  If worker (browser) left and cell is NOT in-progress → cancel cell + complete task
 * - conference-end:     Cancel cell leg only as a safety net
 *
 * Cell accepted on cell phone:
 *   cell-screening kicks browser from conference, bridges caller, joins cell → all in route.ts
 * Cell declined / no-answer:
 *   cell-screening or twilio-status completes task + re-enqueues caller
 */
import twilio from 'twilio';
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function cancelCellLeg(cellCallSid: string, reason: string) {
  if (!cellCallSid) {
    console.warn(`⚠️ cancelCellLeg called with empty cellCallSid (${reason})`);
    return;
  }
  try {
    console.log(`🔍 Fetching cell call status for ${cellCallSid}...`);
    const call = await client.calls(cellCallSid).fetch();
    console.log(`📞 Cell call status: ${call.status}`);
    if (call.status === 'completed' || call.status === 'canceled' || call.status === 'failed') {
      console.log(`ℹ️ Cell leg already ${call.status} — skipping`);
      return;
    }
    const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';
    await client.calls(cellCallSid).update({ status: newStatus });
    console.log(`✅ Cell leg ${cellCallSid} → ${newStatus} (${reason})`);
  } catch (err) {
    console.error(`❌ Error canceling cell leg (${reason}): ${(err as Error).message}`);
  }
}

async function completeTask(taskSid: string, workspaceSid: string, reason: string) {
  try {
    const task = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .fetch();
    if (task.assignmentStatus === 'assigned' || task.assignmentStatus === 'wrapping') {
      await client.taskrouter.v1
        .workspaces(workspaceSid)
        .tasks(taskSid)
        .update({ assignmentStatus: 'completed', reason });
      console.log(`✅ Task ${taskSid} completed (${reason})`);
    } else {
      console.log(`ℹ️ Task already ${task.assignmentStatus}, skipping completion`);
    }
  } catch (error) {
    const msg = (error as Error).message || '';
    if (msg.includes('not currently assigned')) {
      console.log(`ℹ️ Task ${taskSid} already completed — skipping`);
    } else {
      console.error('❌ Failed to complete task:', error);
    }
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const statusCallbackEvent = formData.get('StatusCallbackEvent') as string;
    const conferenceSid = formData.get('ConferenceSid') as string;
    const callSid = formData.get('CallSid') as string;
    const conferenceFriendlyName = formData.get('FriendlyName') as string;

    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const cellCallSid = url.searchParams.get('cellCallSid');
    const workerSid = url.searchParams.get('workerSid');

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('StatusCallbackEvent:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid:', callSid);
    console.log('FriendlyName:', conferenceFriendlyName);
    console.log('TaskSid:', taskSid);
    console.log('WorkerSid:', workerSid ?? 'none');
    console.log('CellCallSid from URL:', cellCallSid ?? 'NONE - NOT PASSED');
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ── ✅ FIX: conference-start no longer cancels the cell ──────────────────
    // Previously this fired cancelCellLeg here, but the browser ALWAYS joins
    // the conference first via the assignment instruction — so conference-start
    // fired before the agent could press 1, killing the screening flow entirely.
    // Cell screening now handles the accept/decline flow completely.
    if (statusCallbackEvent === 'conference-start') {
      console.log(`📱 conference-start fired — browser joined conference, screening in progress`);
      // No action needed here — cell-screening handles accept/decline
    }

    // ── Participant left the conference ──────────────────────────────────────
    if (statusCallbackEvent === 'participant-leave') {
      console.log(`📵 participant-leave fired. CallSid: ${callSid}`);
      if (cellCallSid) {
        if (callSid !== cellCallSid) {
          // A non-cell participant left (browser/app leg or caller).
          // Check if cell is already in-progress before canceling.
          // If cell accepted (in-progress), it's actively talking to the caller
          // — don't cancel it. cell-screening already kicked the browser.
          let cellIsActive = false;
          try {
            const cellCall = await client.calls(cellCallSid).fetch();
            cellIsActive = cellCall.status === 'in-progress';
            console.log(`📞 Cell call status: ${cellCall.status}`);
          } catch (err) {
            console.warn(`⚠️ Could not fetch cell call status:`, (err as Error).message);
          }

          if (cellIsActive) {
            console.log(`ℹ️ App leg left but cell is in-progress — cell accepted, skipping cancel`);
          } else {
            console.log(`📵 Worker left app (${callSid}) — canceling cell leg: ${cellCallSid}`);
            await cancelCellLeg(cellCallSid, 'worker-left');
            await completeTask(taskSid, workspaceSid, 'Worker hung up');
          }
        } else {
          console.log(`📵 Cell itself left — no action needed`);
        }
      } else {
        console.warn(`⚠️ participant-leave fired but cellCallSid is empty`);
      }
    }

    // ── Conference ended — cancel cell leg as safety net ────────────────────
    if (statusCallbackEvent === 'conference-end') {
      console.log(`📵 conference-end fired — canceling cell leg as safety net`);
      if (cellCallSid) {
        await cancelCellLeg(cellCallSid, 'conference-end');
      }
    }

    if (
      statusCallbackEvent !== 'conference-start' &&
      statusCallbackEvent !== 'participant-leave' &&
      statusCallbackEvent !== 'conference-end'
    ) {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}