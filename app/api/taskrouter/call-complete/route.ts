/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 *
 * For simultaneous ring:
 * - conference-start: Someone answered — cancel cell leg
 * - participant-leave: GPP2 left — cancel cell leg AND complete task
 *   ✅ FIX: Check if cell is in-progress before canceling. When cell answers,
 *   the app leg gets canceled which fires participant-leave with the app's
 *   callSid. Without this check we'd cancel the cell that's actively talking.
 * - conference-end: Cancel cell leg only — task completion handled elsewhere
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
    const status = call.status === 'in-progress' ? 'completed' : 'canceled';
    console.log(`📤 Updating cell call to status: ${status}`);
    await client.calls(cellCallSid).update({ status });
    console.log(`✅ Cell leg ${cellCallSid} ${status} (${reason})`);
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

    // ── App answered — cancel cell leg ──
    if (statusCallbackEvent === 'conference-start') {
      console.log(`📱 conference-start fired`);
      if (cellCallSid) {
        console.log(`📱 Someone answered — canceling cell leg: ${cellCallSid}`);
        await cancelCellLeg(cellCallSid, 'conference-start');
      } else {
        console.warn(`⚠️ conference-start fired but cellCallSid is empty`);
      }
    }

    // ── Participant left the conference ──
    if (statusCallbackEvent === 'participant-leave') {
      console.log(`📵 participant-leave fired. CallSid: ${callSid}`);
      if (cellCallSid) {
        if (callSid !== cellCallSid) {
          // ✅ FIX: Check if cell is already in-progress before canceling.
          // When the cell answers, twilio-status cancels the app leg — that fires
          // participant-leave with the app's callSid (≠ cellCallSid). Without this
          // guard we'd incorrectly cancel the cell that's actively talking to the caller.
          let cellIsActive = false;
          try {
            const cellCall = await client.calls(cellCallSid).fetch();
            cellIsActive = cellCall.status === 'in-progress';
            console.log(`📞 Cell call status: ${cellCall.status}`);
          } catch (err) {
            console.warn(`⚠️ Could not fetch cell call status:`, (err as Error).message);
          }

          if (cellIsActive) {
            console.log(`ℹ️ App leg left but cell is in-progress — cell already answered, skipping cell cancel`);
            // Task was already completed in twilio-status in-progress handler — no-op
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

    // ── Conference ended — cancel cell leg only ──
    // Do NOT complete the task here. Caller is held in <Enqueue> by TaskRouter.
    // Completing the task here kicks them out of the queue → voicemail.
    // Task completion is handled by:
    //   - twilio-status in-progress: cell answered
    //   - participant-leave above: app worker hung up
    //   - twilio-status no-answer: reservation rejected, TaskRouter reassigns automatically
    //   - TaskRouter workflow timeout: voicemail worker assigned
    if (statusCallbackEvent === 'conference-end') {
      console.log(`📵 conference-end fired — canceling cell leg only`);
      if (cellCallSid) {
        await cancelCellLeg(cellCallSid, 'conference-end');
      }
    } else if (
      statusCallbackEvent !== 'conference-start' &&
      statusCallbackEvent !== 'participant-leave'
    ) {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}