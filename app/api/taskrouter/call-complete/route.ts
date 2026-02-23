/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 *
 * For simultaneous ring:
 * - conference-start: Someone answered — cancel cell leg if not yet answered
 * - participant-leave: Someone left — if GPP2 left, cancel cell leg
 * - conference-end: Clean up cell leg and complete the task
 * - No-answer timeout: If nobody answers within 20s, reject reservation so TaskRouter rolls to next agent
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function cancelCellLeg(cellCallSid: string, reason: string) {
  try {
    // First, try to get the call status to determine which termination method to use
    const call = await client.calls(cellCallSid).fetch();
    
    // For ringing/unanswered calls, use 'canceled'
    // For in-progress calls, use 'completed'
    const status = call.status === 'in-progress' ? 'completed' : 'canceled';
    
    await client.calls(cellCallSid).update({ status });
    console.log(`✅ Cell leg ${cellCallSid} ${status} (${reason})`);
  } catch (err) {
    // Cell may have already ended — not a problem
    console.log(`ℹ️ Cell leg already ended (${reason}): ${(err as Error).message}`);
  }
}

async function getConferenceParticipants(conferenceSid: string): Promise<Array<{ callSid: string; label?: string }>> {
  try {
    const participants = await client.conferences(conferenceSid).participants.list();
    return participants.map(p => ({
      callSid: p.callSid,
      label: p.label,
    }));
  } catch (err) {
    console.warn(`⚠️ Failed to fetch participants: ${(err as Error).message}`);
    return [];
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
    console.log('CellCallSid:', cellCallSid ?? 'none');
    console.log('═══════════════════════════════════════════');

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid');
      return new Response('Missing parameters', { status: 400 });
    }

    // ── Someone answered — cancel cell leg if it exists ──
    if (statusCallbackEvent === 'conference-start' && cellCallSid) {
      console.log(`📱 Someone answered the call — canceling cell leg: ${cellCallSid}`);
      await cancelCellLeg(cellCallSid, 'conference-start');
    }

    // ── Someone left the conference ──
    if (statusCallbackEvent === 'participant-leave' && conferenceSid && cellCallSid) {
      // The callSid in the participant-leave event is the call that LEFT the conference.
      // If it's not the cell call, then the GPP2 worker left, so we should cancel the cell.
      if (callSid !== cellCallSid) {
        console.log(`📵 Worker left conference (${callSid}) — canceling cell leg: ${cellCallSid}`);
        await cancelCellLeg(cellCallSid, 'worker-left');
      }
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