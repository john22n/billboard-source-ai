/**
 * Simultaneous Dial Complete Handler — McDonald only
 *
 * Called by Twilio as the <Dial action> callback when the simultaneous ring
 * attempt finishes — regardless of outcome.
 *
 * Routing logic:
 *   - completed              → clean hangup (call already finished)
 *   - canceled / no-answer   → re-enqueue with retried=true + excluded_workers
 *                              so TaskRouter skips McDonald on the next attempt
 *   - canceled / no-answer (retried=true) → voicemail (prevent loop)
 *   - busy / failed          → voicemail
 *
 * Query parameters:
 *   taskSid      — TaskRouter Task SID
 *   workspaceSid — TaskRouter Workspace SID
 *   workerSid    — The worker SID that just missed the call (to exclude)
 */

import twilio from 'twilio';

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const WORKFLOW_SID  = process.env.TASKROUTER_WORKFLOW_SID!;

const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

export async function POST(req: Request) {
  try {
    const url          = new URL(req.url);
    const taskSid      = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') ?? WORKSPACE_SID;
    // ── NEW: read workerSid from query params
    const workerSid    = url.searchParams.get('workerSid') ?? '';

    const formData         = await req.formData();
    const dialCallStatus   = formData.get('DialCallStatus')   as string | null;
    const dialCallDuration = formData.get('DialCallDuration') as string | null;

    console.log('═══════════════════════════════════════════');
    console.log('📱 SIMULTANEOUS DIAL COMPLETE — McDONALD');
    console.log('DialCallStatus:',   dialCallStatus);
    console.log('DialCallDuration:', dialCallDuration ? `${dialCallDuration}s` : 'n/a');
    console.log('TaskSid:',          taskSid);
    console.log('WorkerSid:',        workerSid);
    console.log('═══════════════════════════════════════════');

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`
    ).replace(/\/$/, '');

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

    // ── Helper: build voicemail redirect TwiML ───────────────────────────────
    const buildVoicemailTwiml = () => {
      const voicemailUrl = new URL(`${appUrl}/api/taskrouter/voicemail`);
      if (taskSid)      voicemailUrl.searchParams.set('taskSid',      taskSid);
      if (workspaceSid) voicemailUrl.searchParams.set('workspaceSid', workspaceSid);
      if (process.env.VERCEL_BYPASS_TOKEN) {
        voicemailUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
      }
      const escapedVoicemailUrl = voicemailUrl.toString().replace(/&/g, '&amp;');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${escapedVoicemailUrl}</Redirect>
</Response>`;
    };

    // ── completed → clean hangup ─────────────────────────────────────────────
    if (!dialCallStatus || dialCallStatus === 'completed') {
      console.log(`📞 DialCallStatus="${dialCallStatus}" — hanging up cleanly`);

      if (taskSid && workspaceSid) {
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
                reason: 'Simultaneous dial completed successfully',
              });
            console.log(`✅ Task ${taskSid} completed`);
          }
        } catch (taskErr) {
          console.error('❌ Failed to complete task:', taskErr);
        }
      }

      return new Response(HANGUP_TWIML, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // ── Fetch task attributes for all non-completed cases ────────────────────
    let taskAttributes: Record<string, unknown> = {};
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
              reason: `Simultaneous dial finished: ${dialCallStatus ?? 'unknown'}`,
            });
          console.log(`✅ Task ${taskSid} completed (DialCallStatus: ${dialCallStatus})`);
        } else {
          console.log(`ℹ️ Task ${taskSid} is already "${task.assignmentStatus}" — skipping completion`);
        }
      } catch (taskErr) {
        console.error('❌ Failed to fetch/complete simultaneous-dial task:', taskErr);
      }
    } else {
      console.warn('⚠️ Missing taskSid or workspaceSid — task will not be completed');
    }

    // ── canceled or no-answer → re-enqueue once, then voicemail ─────────────
    if (dialCallStatus === 'canceled' || dialCallStatus === 'no-answer') {

      // Already retried once — stop looping, go to voicemail
      if (taskAttributes.retried) {
        console.log('📼 Already retried once — sending to voicemail to prevent loop');
        return new Response(buildVoicemailTwiml(), {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        });
      }

      // ── NEW: build excluded_workers array ───────────────────────────────
      // Carry forward any previously excluded workers and add the current one.
      // TaskRouter workflow filter uses: worker.sid NOT IN task.excluded_workers
      const previouslyExcluded = Array.isArray(taskAttributes.excluded_workers)
        ? (taskAttributes.excluded_workers as string[])
        : [];
      const excludedWorkers = workerSid
        ? [...new Set([...previouslyExcluded, workerSid])]
        : previouslyExcluded;

      console.log('🔄 No answer from McDonald — re-enqueueing, excluded workers:', excludedWorkers);

      const waitUrl          = `${appUrl}/api/taskrouter/wait?retry=true`;
      const enqueueActionUrl = `${appUrl}/api/taskrouter/enqueue-complete`;

      const newTaskAttributes = JSON.stringify({
        ...taskAttributes,
        retried: true,
        excluded_workers: excludedWorkers, // ── NEW
      });

      const escapedWaitUrl          = waitUrl.replace(/&/g, '&amp;');
      const escapedEnqueueActionUrl = enqueueActionUrl.replace(/&/g, '&amp;');

      const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Enqueue workflowSid="${WORKFLOW_SID}"
           action="${escapedEnqueueActionUrl}"
           method="POST"
           waitUrl="${escapedWaitUrl}"
           waitUrlMethod="POST">
    <Task>${newTaskAttributes}</Task>
  </Enqueue>
</Response>`;

      return new Response(requeueTwiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // ── busy / failed → voicemail ────────────────────────────────────────────
    console.log(`📼 DialCallStatus="${dialCallStatus}" — redirecting to voicemail`);
    return new Response(buildVoicemailTwiml(), {
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