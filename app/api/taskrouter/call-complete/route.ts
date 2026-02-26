/**
 * Conference Status Callback
 *
 * Handles browser-side conference events only.
 * Cell-side cleanup is handled by twilio-status/route.ts (more reliable per-call callbacks).
 *
 * Browser answered (conference-start) → cancel cell leg
 * Browser/worker hung up (participant-leave, cell not active) → cancel cell + complete task
 * Cell hung up (participant-leave, callSid === cellCallSid) → already handled by twilio-status, skip
 * conference-end → cancel cell as safety net only
 */
import twilio from 'twilio';

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function cancelCall(callSid: string, reason: string) {
  if (!callSid) return;
  try {
    const call = await client.calls(callSid).fetch();
    if (['completed', 'canceled', 'failed', 'busy', 'no-answer'].includes(call.status)) {
      console.log(`ℹ️ Call ${callSid} already ${call.status} — skipping (${reason})`);
      return;
    }
    const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';
    await client.calls(callSid).update({ status: newStatus });
    console.log(`✅ Call ${callSid} → ${newStatus} (${reason})`);
  } catch (err) {
    console.error(`❌ cancelCall ${callSid} (${reason}): ${(err as Error).message}`);
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
      console.log(`ℹ️ Task already ${task.assignmentStatus} — skipping (${reason})`);
    }
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('not currently assigned')) {
      console.log(`ℹ️ Task ${taskSid} already completed — skipping`);
    } else {
      console.error('❌ completeTask failed:', err);
    }
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const statusCallbackEvent    = formData.get('StatusCallbackEvent') as string;
    const conferenceSid          = formData.get('ConferenceSid') as string;
    const callSid                = formData.get('CallSid') as string;
    const conferenceFriendlyName = formData.get('FriendlyName') as string;

    const url          = new URL(req.url);
    const reservationSid = url.searchParams.get('reservationSid');
    const taskSid      = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    let cellCallSid    = url.searchParams.get('cellCallSid') || '';
    const workerSid    = url.searchParams.get('workerSid');

    // ✅ FIX: If reservationSid is present, lookup cellCallSid from cache (primary)
    // Fallback to URL param (secondary)
    if (reservationSid && !cellCallSid) {
      const { getSimringContext } = await import('@/lib/simring-cache');
      const cached = await getSimringContext(reservationSid);
      if (cached?.cellCallSid) {
        cellCallSid = cached.cellCallSid;
        console.log(`📦 Retrieved cellCallSid from cache: ${cellCallSid}`);
      }
    }

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('Event:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid (who triggered):', callSid);
    console.log('FriendlyName:', conferenceFriendlyName);
    console.log('ReservationSid:', reservationSid ?? 'none');
    console.log('TaskSid:', taskSid);
    console.log('CellCallSid:', cellCallSid || 'NONE — browser-only call');
    console.log('WorkerSid:', workerSid ?? 'none');
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ── Browser answered → cancel cell ───────────────────────────────────────
    // conference-start fires when the browser agent clicks Accept.
    // Stop the cell from ringing — agent already answered on browser.
    if (statusCallbackEvent === 'conference-start') {
      if (cellCallSid) {
        console.log(`🖥️ Browser answered — canceling cell leg: ${cellCallSid}`);
        await cancelCall(cellCallSid, 'browser answered');
      } else {
        console.log(`🖥️ Browser answered — no cell leg (browser-only call)`);
      }
    }

    // ── A participant left the conference ─────────────────────────────────────
    if (statusCallbackEvent === 'participant-leave') {
      console.log(`📵 participant-leave — CallSid: ${callSid}`);

      if (callSid === cellCallSid) {
        // Cell leg left — twilio-status already handles this via the per-call callback.
        // Nothing to do here to avoid double-processing.
        console.log(`ℹ️ Cell leg left the conference — handled by twilio-status, skipping`);

      } else {
        // Browser/worker or caller left the conference.
        // Check if cell is in-progress (i.e. cell accepted and is talking to caller).
        // If yes — cell-screening already kicked the browser, this is just the kicked
        // browser triggering participant-leave. Don't touch anything.
        // If no — browser/worker hung up while cell was still ringing or idle. Cancel cell.
        let cellIsActive = false;
        if (cellCallSid) {
          try {
            const cellCall = await client.calls(cellCallSid).fetch();
            cellIsActive = cellCall.status === 'in-progress';
            console.log(`📞 Cell status: ${cellCall.status}`);
          } catch (err) {
            console.warn(`⚠️ Could not fetch cell status:`, (err as Error).message);
          }
        }

        if (cellIsActive) {
          console.log(`ℹ️ App leg left but cell is in-progress — cell accepted, no action needed`);
        } else {
          console.log(`📵 Browser/worker hung up (${callSid}) — canceling cell + completing task`);
          if (cellCallSid) {
            await cancelCall(cellCallSid, 'browser/worker hung up');
          }
          if (taskSid) {
            await completeTask(taskSid, workspaceSid, 'Worker hung up on browser');
          }
        }
      }
    }

    // ── Conference ended — safety net only ────────────────────────────────────
    // Primary cleanup is handled by twilio-status (cell) and participant-leave (browser).
    // This is a last-resort catch for anything that slipped through.
    if (statusCallbackEvent === 'conference-end') {
      console.log(`📵 conference-end — safety net`);
      if (cellCallSid) {
        await cancelCall(cellCallSid, 'conference-end safety net');
      }
      // Don't complete task here — participant-leave or twilio-status handle it
    }

    if (
      statusCallbackEvent !== 'conference-start' &&
      statusCallbackEvent !== 'participant-leave' &&
      statusCallbackEvent !== 'conference-end'
    ) {
      console.log(`ℹ️ Other conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}