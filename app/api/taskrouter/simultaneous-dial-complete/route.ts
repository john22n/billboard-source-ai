/**
 * Simultaneous Dial Complete Handler — McDonald only
 *
 * Called by Twilio as the <Dial action> callback when the simultaneous ring
 * attempt finishes — regardless of outcome:
 *   - "completed"  — a leg answered, the call ran, then hung up
 *   - "no-answer"  — timeout elapsed before either leg answered
 *   - "busy"       — both legs were busy
 *   - "failed"     — dial failed (e.g. invalid number, carrier error)
 *   - "canceled"   — caller hung up before either leg answered
 *
 * Responsibilities:
 *   1. Complete the TaskRouter task so McDonald's worker activity resets to
 *      Available (honoring the post_work_activity_sid set in the redirect
 *      instruction from the assignment callback).
 *   2. Return <Hangup/> TwiML to cleanly end the caller's call leg.
 *
 * Query parameters (forwarded from the simultaneous-dial action attribute):
 *   taskSid      — TaskRouter Task SID
 *   workspaceSid — TaskRouter Workspace SID
 */

import twilio from 'twilio';

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

// Shared hangup response — returned in all code paths
const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

export async function POST(req: Request) {
  try {
    const url          = new URL(req.url);
    const taskSid      = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') ?? WORKSPACE_SID;

    const formData          = await req.formData();
    const dialCallStatus    = formData.get('DialCallStatus')   as string | null;
    const dialCallDuration  = formData.get('DialCallDuration') as string | null;

    console.log('═══════════════════════════════════════════');
    console.log('📱 SIMULTANEOUS DIAL COMPLETE — McDONALD');
    console.log('DialCallStatus:',   dialCallStatus);
    console.log('DialCallDuration:', dialCallDuration ? `${dialCallDuration}s` : 'n/a');
    console.log('TaskSid:',          taskSid);
    console.log('═══════════════════════════════════════════');

    // ── Complete the TaskRouter task ────────────────────────────────────────
    // This releases McDonald's worker reservation and (via post_work_activity_sid
    // set in the assignment callback redirect instruction) returns his activity
    // to Available so he can receive the next call.
    if (taskSid && workspaceSid) {
      const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        if (task.assignmentStatus === 'assigned' || task.assignmentStatus === 'wrapping') {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: `Simultaneous dial finished: ${dialCallStatus ?? 'unknown'}`,
            });
          console.log(`✅ Task ${taskSid} completed (DialCallStatus: ${dialCallStatus})`);
        } else {
          console.log(`ℹ️ Task ${taskSid} is already "${task.assignmentStatus}" — skipping completion`);
        }
      } catch (taskErr) {
        // Non-fatal: log and continue so the caller still gets a clean hangup
        console.error('❌ Failed to complete simultaneous-dial task:', taskErr);
      }
    } else {
      console.warn('⚠️ Missing taskSid or workspaceSid — task will not be completed');
    }

    // Always hang up the caller's leg cleanly
    return new Response(HANGUP_TWIML, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Simultaneous dial complete handler error:', error);
    return new Response(HANGUP_TWIML, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
