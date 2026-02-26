/**
 * Conference Status Callback
 *
 * Full bidirectional cleanup:
 *
 * App answered  → conference-start  → cancel cell leg
 * App hangup    → participant-leave (callSid ≠ cellCallSid, cell not active) → cancel cell + complete task
 * Cell answered → cell-screening kicks browser from conference (handled in cell-screening/route.ts)
 * Cell hangup   → participant-leave (callSid === cellCallSid) → cancel remaining participants (browser) + complete task
 * Safety net    → conference-end → cancel cell if still alive
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function cancelCall(callSid: string, reason: string) {
  if (!callSid) {
    console.warn(`⚠️ cancelCall called with empty callSid (${reason})`);
    return;
  }
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

/**
 * Remove all remaining participants from a conference by conferenceSid.
 * Used when cell hangs up — kicks the browser leg so it doesn't
 * sit in a dead conference.
 */
async function removeAllParticipants(conferenceSid: string, exceptCallSid?: string) {
  try {
    const participants = await client.conferences(conferenceSid).participants.list();
    console.log(`📋 Removing ${participants.length} remaining participant(s) from ${conferenceSid}`);
    for (const p of participants) {
      if (exceptCallSid && p.callSid === exceptCallSid) continue;
      try {
        await client.conferences(conferenceSid).participants(p.callSid).remove();
        console.log(`✅ Removed participant ${p.callSid} from conference`);
      } catch (err) {
        // Participant may have already left — cancel the underlying call as fallback
        console.warn(`⚠️ remove() failed for ${p.callSid}, trying cancelCall:`, (err as Error).message);
        await cancelCall(p.callSid, 'removeAllParticipants fallback');
      }
    }
  } catch (err) {
    console.error('❌ removeAllParticipants failed:', (err as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const statusCallbackEvent    = formData.get('StatusCallbackEvent') as string;
    const conferenceSid          = formData.get('ConferenceSid') as string;
    const callSid                = formData.get('CallSid') as string;
    const conferenceFriendlyName = formData.get('FriendlyName') as string;

    const url           = new URL(req.url);
    const taskSid       = url.searchParams.get('taskSid');
    const workspaceSid  = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const cellCallSid   = url.searchParams.get('cellCallSid') || '';
    const workerSid     = url.searchParams.get('workerSid');

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('Event:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid (who triggered):', callSid);
    console.log('FriendlyName:', conferenceFriendlyName);
    console.log('TaskSid:', taskSid);
    console.log('CellCallSid:', cellCallSid || 'NONE');
    console.log('WorkerSid:', workerSid ?? 'none');
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ── Agent answered on browser → cancel cell ──────────────────────────────
    // conference-start fires when the browser client joins the conference (i.e.
    // agent clicks Accept in the app). Cancel the ringing cell so it stops
    // ringing after the agent already answered on the browser.
    if (statusCallbackEvent === 'conference-start') {
      console.log(`🖥️ conference-start — browser answered, canceling cell leg`);
      if (cellCallSid) {
        await cancelCall(cellCallSid, 'browser answered');
      } else {
        console.log(`ℹ️ No cellCallSid — browser-only call, nothing to cancel`);
      }
    }

    // ── A participant left the conference ─────────────────────────────────────
    if (statusCallbackEvent === 'participant-leave') {
      console.log(`📵 participant-leave — CallSid: ${callSid}`);

      if (callSid === cellCallSid) {
        // ── Cell leg hung up → cancel browser leg + complete task ────────────
        // Cell was the one that left. The browser leg is now sitting in an
        // empty conference. Remove all remaining participants and complete task.
        console.log(`📵 Cell hung up — removing browser leg and completing task`);
        await removeAllParticipants(conferenceSid, cellCallSid);
        if (taskSid) {
          await completeTask(taskSid, workspaceSid, 'Cell hung up');
        }

      } else {
        // ── Non-cell participant left (browser/worker or caller) ─────────────
        // Check if cell is actively in-progress. If it is, cell-screening already
        // accepted and kicked the browser — this is just the browser leaving after
        // being kicked, so no action needed.
        // If cell is NOT in-progress, the worker hung up on the browser — cancel
        // the cell and complete the task.
        let cellIsActive = false;
        if (cellCallSid) {
          try {
            const cellCall = await client.calls(cellCallSid).fetch();
            cellIsActive = cellCall.status === 'in-progress';
            console.log(`📞 Cell call status: ${cellCall.status}`);
          } catch (err) {
            console.warn(`⚠️ Could not fetch cell call status:`, (err as Error).message);
          }
        }

        if (cellIsActive) {
          console.log(`ℹ️ App leg left but cell is in-progress — cell accepted, no action needed`);
        } else {
          console.log(`📵 Browser/worker hung up (${callSid}) — canceling cell + completing task`);
          if (cellCallSid) {
            await cancelCall(cellCallSid, 'browser hung up');
          }
          if (taskSid) {
            await completeTask(taskSid, workspaceSid, 'Worker hung up on browser');
          }
        }
      }
    }

    // ── Conference ended — safety net ─────────────────────────────────────────
    // Task completion is handled by participant-leave above.
    // Just cancel the cell if it somehow survived to this point.
    if (statusCallbackEvent === 'conference-end') {
      console.log(`📵 conference-end — safety net cancel cell`);
      if (cellCallSid) {
        await cancelCall(cellCallSid, 'conference-end safety net');
      }
    }

    if (
      statusCallbackEvent !== 'conference-start' &&
      statusCallbackEvent !== 'participant-leave' &&
      statusCallbackEvent !== 'conference-end'
    ) {
      console.log(`ℹ️ Unhandled conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}