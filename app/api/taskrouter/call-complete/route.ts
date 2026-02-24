/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 *
 * For simultaneous ring:
 * - conference-start: Someone answered — cancel cell leg
 * - participant-leave: GPP2 left — cancel cell leg AND complete task
 * - conference-end: Re-enqueue caller if still live, then complete the task
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

    // ── GPP2 answered — cancel cell leg ──
    if (statusCallbackEvent === 'conference-start') {
      console.log(`📱 conference-start fired`);
      if (cellCallSid) {
        console.log(`📱 Someone answered — canceling cell leg: ${cellCallSid}`);
        await cancelCellLeg(cellCallSid, 'conference-start');
      } else {
        console.warn(`⚠️ conference-start fired but cellCallSid is empty`);
      }
    }

    // ── GPP2 hung up — cancel cell AND complete task ──
    if (statusCallbackEvent === 'participant-leave') {
      console.log(`📵 participant-leave fired. CallSid: ${callSid}`);
      if (cellCallSid) {
        if (callSid !== cellCallSid) {
          console.log(`📵 Worker left (${callSid}) — canceling cell leg: ${cellCallSid}`);
          await cancelCellLeg(cellCallSid, 'worker-left');
          await completeTask(taskSid, workspaceSid, 'Worker hung up');
        } else {
          console.log(`📵 Cell itself left — no action needed`);
        }
      } else {
        console.warn(`⚠️ participant-leave fired but cellCallSid is empty`);
      }
    }

    // ── Conference ended ──
    //
    // ✅ FIX: Previously this just completed the task unconditionally, which dropped
    // the caller even when the conference ended because the cell declined (no-answer).
    // The caller was never in the conference yet, so completing the task via TaskRouter
    // ended their call before the re-enqueue redirect in twilio-status could fire.
    //
    // Now: we check if the caller's original call is still live. If it is, redirect
    // them back to /api/twilio-inbound FIRST so they get re-queued to the next agent,
    // THEN complete the task. If the call is already gone (caller hung up themselves),
    // just complete the task as before.
    if (statusCallbackEvent === 'conference-end') {
      console.log(`📵 conference-end fired`);

      if (cellCallSid) {
        await cancelCellLeg(cellCallSid, 'conference-end');
      }

      // Try to re-enqueue the caller before completing the task
      // The callerCallSid is stored in the task attributes
      let callerReEnqueued = false;
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        const taskAttrs = JSON.parse(task.attributes || '{}');
        const callerCallSid = taskAttrs.call_sid as string | undefined;

        console.log(`🔍 Caller call_sid from task attributes: ${callerCallSid ?? 'none'}`);

        if (callerCallSid) {
          try {
            const callerCall = await client.calls(callerCallSid).fetch();
            console.log(`📞 Caller call status: ${callerCall.status}`);

            if (callerCall.status === 'in-progress') {
              const { protocol, host } = new URL(req.url);
              const inboundUrl = `${protocol}//${host}/api/twilio-inbound`;
              const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${inboundUrl}</Redirect></Response>`;
              await client.calls(callerCallSid).update({ twiml: requeueTwiml });
              console.log(`✅ Caller ${callerCallSid} re-enqueued via conference-end — will ring next available agent`);
              callerReEnqueued = true;
            } else {
              console.log(`ℹ️ Caller ${callerCallSid} is no longer in-progress (${callerCall.status}) — skipping re-enqueue`);
            }
          } catch (err) {
            console.error(`❌ Failed to fetch/redirect caller call: ${(err as Error).message}`);
          }
        } else {
          console.warn('⚠️ No call_sid in task attributes — cannot re-enqueue caller');
        }
      } catch (err) {
        console.error(`❌ Failed to fetch task attributes for re-enqueue: ${(err as Error).message}`);
      }

      // Complete the task now that caller is re-enqueued (or already gone)
      const reason = callerReEnqueued ? 'Conference ended — caller re-enqueued' : 'Conference ended';
      await completeTask(taskSid, workspaceSid, reason);
    } else if (statusCallbackEvent !== 'conference-start' && statusCallbackEvent !== 'participant-leave') {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}