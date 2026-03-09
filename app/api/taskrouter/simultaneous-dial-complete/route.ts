/**
 * Simultaneous Dial Complete Handler
 *
 * Called by Twilio as the <Dial action> callback when the simultaneous ring
 * attempt finishes — regardless of outcome.
 *
 * Routing logic:
 *   - completed (duration >= 4s)  → clean hangup (genuine answer)
 *   - completed (duration < 4s)   → treat as no-answer (carrier voicemail)
 *   - canceled / no-answer        → re-enqueue with retried=true + excluded_workers
 *                                   so TaskRouter skips McDonald on the next attempt
 *   - canceled / no-answer (retried=true) → voicemail (prevent loop)
 *   - busy / failed               → voicemail
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

// Carrier voicemail answers in ~0-2s. A real human answer takes longer.
// Anything under this threshold on a "completed" status is treated as voicemail.
const VOICEMAIL_DURATION_THRESHOLD_SECONDS = 4;

const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

export async function POST(req: Request) {
  try {
    const url          = new URL(req.url);
    const taskSid      = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') ?? WORKSPACE_SID;
    const workerSid    = url.searchParams.get('workerSid') ?? '';

    const formData         = await req.formData();
    let   dialCallStatus   = formData.get('DialCallStatus')   as string | null;
    const dialCallDuration = formData.get('DialCallDuration') as string | null;

    const durationSeconds = dialCallDuration ? parseInt(dialCallDuration, 10) : null;

    console.log('═══════════════════════════════════════════');
    console.log('📱 SIMULTANEOUS DIAL COMPLETE');
    console.log('DialCallStatus:',   dialCallStatus);
    console.log('DialCallDuration:', durationSeconds != null ? `${durationSeconds}s` : 'n/a');
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

    // ── completed → check duration to detect carrier voicemail ──────────────
    if (!dialCallStatus || dialCallStatus === 'completed') {

      const isCarrierVoicemail =
        durationSeconds != null &&
        durationSeconds < VOICEMAIL_DURATION_THRESHOLD_SECONDS;

      if (isCarrierVoicemail) {
        console.log(`⚠️ "completed" but duration=${durationSeconds}s < ${VOICEMAIL_DURATION_THRESHOLD_SECONDS}s — carrier voicemail detected, treating as no-answer`);
        // Override so it falls through to re-enqueue logic below
        dialCallStatus = 'no-answer';
      } else {
        // Genuine answer — complete the task and hang up cleanly
        console.log(`📞 DialCallStatus="completed" duration=${durationSeconds ?? 'unknown'}s — hanging up cleanly`);

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

      // Build excluded_workers array — carry forward any previously excluded workers
      const previouslyExcluded = Array.isArray(taskAttributes.excluded_workers)
        ? (taskAttributes.excluded_workers as string[])
        : [];
      const excludedWorkers = workerSid
        ? [...new Set([...previouslyExcluded, workerSid])]
        : previouslyExcluded;

      console.log('🔄 No answer — re-enqueueing, excluded workers:', excludedWorkers);

      // ── Build waitUrl with bypass token ──────────────────────────────────
      const waitUrlObj = new URL(`${appUrl}/api/taskrouter/wait`);
      waitUrlObj.searchParams.set('retry', 'true');
      if (process.env.VERCEL_BYPASS_TOKEN) {
        waitUrlObj.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
      }

      // ── Build enqueueActionUrl with bypass token ──────────────────────────
      const enqueueActionUrlObj = new URL(`${appUrl}/api/taskrouter/enqueue-complete`);
      if (process.env.VERCEL_BYPASS_TOKEN) {
        enqueueActionUrlObj.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
      }

      const newTaskAttributes = JSON.stringify({
        ...taskAttributes,
        retried: true,
        excluded_workers: excludedWorkers,
      });

      const escapedWaitUrl          = waitUrlObj.toString().replace(/&/g, '&amp;');
      const escapedEnqueueActionUrl = enqueueActionUrlObj.toString().replace(/&/g, '&amp;');

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