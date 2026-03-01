/**
 * AMD Status Callback — Simultaneous Ring
 *
 * Fired by Twilio when Answering Machine Detection completes on the cell
 * phone leg of the simultaneous dial. This fires shortly after the cell
 * answers, before any audio is exchanged with the caller.
 *
 * AnsweredBy values:
 *   human               — real person answered → do nothing, call proceeds
 *   machine_start       — machine detected at start of greeting
 *   machine_end_beep    — machine greeting finished, beep detected
 *   machine_end_silence — machine greeting finished, silence detected
 *   machine_end_other   — machine greeting finished, other ending
 *   fax                 — fax machine detected
 *   unknown             — could not determine
 *
 * When machine is detected:
 *   1. Cancel the cell outbound leg so it doesn't leave a voicemail
 *   2. Redirect the caller's live call to requeue into TaskRouter
 *   3. Complete the TaskRouter task so McDonald resets to Available
 *
 * Query parameters (set by simultaneous-dial/route.ts):
 *   taskSid      — TaskRouter Task SID
 *   workspaceSid — TaskRouter Workspace SID
 *   cellPhone    — E.164 cell number (for logging)
 */

import twilio from 'twilio';

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID  = process.env.TASKROUTER_WORKFLOW_SID!;

export async function POST(req: Request) {
  try {
    const url         = new URL(req.url);
    const taskSid     = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') ?? WORKSPACE_SID;
    const cellPhone   = url.searchParams.get('cellPhone');

    const formData    = await req.formData();
    const answeredBy  = formData.get('AnsweredBy')  as string | null;
    const callSid     = formData.get('CallSid')     as string | null; // cell outbound leg SID

    console.log('═══════════════════════════════════════════');
    console.log('🤖 AMD STATUS CALLBACK');
    console.log('AnsweredBy:', answeredBy);
    console.log('CallSid (cell leg):', callSid);
    console.log('TaskSid:', taskSid);
    console.log('CellPhone:', cellPhone?.replace(/\d(?=\d{4})/g, '*'));
    console.log('═══════════════════════════════════════════');

    const isMachine = answeredBy && answeredBy.startsWith('machine');
    const isFax     = answeredBy === 'fax';

    if (!isMachine && !isFax) {
      // Human answered — let the call proceed normally, do nothing
      console.log(`✅ AnsweredBy="${answeredBy}" — human detected, call proceeds normally`);
      return new Response(null, { status: 204 });
    }

    // Machine or fax detected — cancel cell leg and requeue caller
    console.log(`🤖 AnsweredBy="${answeredBy}" — machine/fax detected, canceling cell and requeuing`);

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`
    ).replace(/\/$/, '');

    // ── Step 1: Cancel the cell outbound leg ─────────────────────────────────
    if (callSid) {
      try {
        await client.calls(callSid).update({ status: 'canceled' });
        console.log(`✅ Canceled cell leg ${callSid}`);
      } catch (err: unknown) {
        // Non-fatal — cell leg may have already ended
        console.warn(`⚠️ Could not cancel cell leg ${callSid}:`, (err as Error).message);
      }
    }

    // ── Step 2: Fetch task attributes and complete the task ──────────────────
    let taskAttributes: Record<string, string> = {};
    if (taskSid && workspaceSid) {
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        taskAttributes = JSON.parse(task.attributes || '{}');

        if (task.assignmentStatus === 'assigned' || task.assignmentStatus === 'wrapping') {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: `AMD detected machine (${answeredBy}) — requeuing caller`,
            });
          console.log(`✅ Task ${taskSid} completed`);
        }
      } catch (taskErr) {
        console.error('❌ Failed to fetch/complete task:', taskErr);
      }
    }

    // ── Step 3: Redirect the caller's live call to requeue ───────────────────
    // The caller's call SID is stored in the task attributes as call_sid.
    // We use the REST API to redirect it to a new <Enqueue> so TaskRouter
    // can route to the next available worker.
    const callerCallSid = taskAttributes.call_sid;
    if (callerCallSid) {
      const waitUrl          = `${appUrl}/api/taskrouter/wait?retry=true`;
      const enqueueActionUrl = `${appUrl}/api/taskrouter/enqueue-complete`;

      const newTaskAttributes = JSON.stringify({
        ...taskAttributes,
        retried: true,
      });

      // Build a TwiML URL that re-enqueues the caller
      // We redirect to a small requeue endpoint that returns <Enqueue> TwiML
      const requeueUrl = new URL(`${appUrl}/api/taskrouter/requeue`);
      requeueUrl.searchParams.set('workflowSid',      WORKFLOW_SID);
      requeueUrl.searchParams.set('taskAttributes',   newTaskAttributes);
      requeueUrl.searchParams.set('waitUrl',          waitUrl);
      requeueUrl.searchParams.set('enqueueActionUrl', enqueueActionUrl);
      if (process.env.VERCEL_BYPASS_TOKEN) {
        requeueUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
      }

      try {
        await client.calls(callerCallSid).update({
          url:    requeueUrl.toString(),
          method: 'POST',
        });
        console.log(`✅ Caller call ${callerCallSid} redirected to requeue`);
      } catch (redirectErr) {
        console.error('❌ Failed to redirect caller call:', redirectErr);
      }
    } else {
      console.warn('⚠️ No call_sid in task attributes — cannot redirect caller');
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ AMD status callback error:', error);
    return new Response(null, { status: 500 });
  }
}