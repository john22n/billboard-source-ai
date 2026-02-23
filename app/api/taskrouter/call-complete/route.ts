/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 *
 * For simultaneous ring:
 * - conference-start: GPP2 answered — cancel cell leg by SID
 * - participant-leave: someone left — cancel cell leg in case GPP2 hung up
 * - conference-end: clean up cell leg and complete the task
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function cancelCellLeg(cellCallSid: string, reason: string) {
  try {
    await client.calls(cellCallSid).update({ status: 'canceled' });
    console.log(`✅ Cell leg ${cellCallSid} canceled (${reason})`);
  } catch (err) {
    // Cell may have already ended — not a problem
    console.log(`ℹ️ Cell leg already ended (${reason}): ${(err as Error).message}`);
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

    console.log('═══════════════════════════════════════════');
    console.log('📞 CONFERENCE STATUS CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('StatusCallbackEvent:', statusCallbackEvent);
    console.log('ConferenceSid:', conferenceSid);
    console.log('CallSid:', callSid);
    console.log('FriendlyName:', conferenceFriendlyName);
    console.log('TaskSid:', taskSid);
    console.log('CellCallSid:', cellCallSid ?? 'none');
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ── GPP2 answered — cancel cell immediately ──
    if (statusCallbackEvent === 'conference-start' && cellCallSid) {
      console.log(`📵 GPP2 answered — canceling cell leg: ${cellCallSid}`);
      await cancelCellLeg(cellCallSid, 'GPP2 answered');
    }

    // ── Someone left the conference — cancel cell in case GPP2 hung up ──
    if (statusCallbackEvent === 'participant-leave' && cellCallSid) {
      console.log(`📵 Participant left — canceling cell leg: ${cellCallSid}`);
      await cancelCellLeg(cellCallSid, 'participant-leave');
    }

    // ── Conference ended — cancel cell and complete task ──
    if (statusCallbackEvent === 'conference-end') {
      if (cellCallSid) {
        await cancelCellLeg(cellCallSid, 'conference-end');
      }

      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        if (task.assignmentStatus === 'assigned' || task.assignmentStatus === 'wrapping') {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({ assignmentStatus: 'completed', reason: 'Conference ended' });
          console.log(`✅ Task ${taskSid} completed (was ${task.assignmentStatus})`);
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
    } else {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Conference status callback error:', error);
    return new Response('Error', { status: 500 });
  }
}