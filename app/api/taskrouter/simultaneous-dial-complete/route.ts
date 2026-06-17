/**
 * Simultaneous Dial Complete Handler
 *
 * Called by Twilio as the <Dial action> callback when the simultaneous ring
 * attempt finishes — regardless of outcome.
 *
 * Routing logic:
 *   - completed (duration >= 4s)  → clean hangup (genuine answer)
 *   - completed (duration < 4s)   → treat as no-answer (carrier voicemail)
 *   - completed (duration = null) → treat as no-answer (rejected during screening)
 *   - canceled / no-answer        → reset worker to back of queue, re-enqueue with
 *                                   retried=true + excluded_workers so TaskRouter
 *                                   skips cell user on the next attempt
 *   - canceled / no-answer (retried=true) → voicemail (prevent loop)
 *   - busy / failed               → voicemail
 *
 * Query parameters:
 *   taskSid      — TaskRouter Task SID
 *   workspaceSid — TaskRouter Workspace SID
 *   workerSid    — The worker SID that just missed the call (to exclude)
 */

import twilio from 'twilio'
import {
  recordAcceptedAttempt,
  recordMissedAttempt,
} from '@/lib/call-attempt-outcomes'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!
const BUSY_ACTIVITY_SID = process.env.TASKROUTER_ACTIVITY_BUSY_SID!
const AVAILABLE_ACTIVITY_SID = process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID!

// Only trust "completed" as a genuine answer if the call lasted at least this long.
// - null duration = rejected during call screening prompt → re-enqueue
// - duration < 4s = carrier voicemail answered → re-enqueue
// - duration >= 4s = real human answered → hang up cleanly
const GENUINE_ANSWER_THRESHOLD_SECONDS = 4

const HANGUP_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid = url.searchParams.get('workspaceSid') ?? WORKSPACE_SID
    const workerSid = url.searchParams.get('workerSid') ?? ''
    const reservationSid = url.searchParams.get('reservationSid') ?? ''

    const formData = await req.formData()
    let dialCallStatus = formData.get('DialCallStatus') as string | null
    const dialCallDuration = formData.get('DialCallDuration') as string | null

    const durationSeconds = dialCallDuration
      ? parseInt(dialCallDuration, 10)
      : null

    console.log('═══════════════════════════════════════════')
    console.log('📱 SIMULTANEOUS DIAL COMPLETE')
    console.log('DialCallStatus:', dialCallStatus)
    console.log(
      'DialCallDuration:',
      durationSeconds != null ? `${durationSeconds}s` : 'n/a',
    )
    console.log('TaskSid:', taskSid)
    console.log('WorkerSid:', workerSid)
    console.log('═══════════════════════════════════════════')

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`
    ).replace(/\/$/, '')

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

    // ── Helper: reset worker to back of queue ────────────────────────────────
    const resetWorkerToBack = async () => {
      if (!workerSid || !BUSY_ACTIVITY_SID || !AVAILABLE_ACTIVITY_SID) return
      try {
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .workers(workerSid)
          .update({ activitySid: BUSY_ACTIVITY_SID })
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .workers(workerSid)
          .update({ activitySid: AVAILABLE_ACTIVITY_SID })
        console.log(
          `✅ Worker ${workerSid} reset to back of queue after missed simultaneous dial`,
        )
      } catch (err) {
        console.error(
          '❌ Failed to reset worker after missed simultaneous dial:',
          err,
        )
      }
    }

    // ── Helper: switch worker back to Available after answered call ───────────
    const switchWorkerToAvailable = async () => {
      if (!workerSid || !AVAILABLE_ACTIVITY_SID) return
      try {
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .workers(workerSid)
          .update({ activitySid: AVAILABLE_ACTIVITY_SID })
        console.log(
          `✅ Worker ${workerSid} switched back to Available after genuine answer`,
        )
      } catch (err) {
        console.error('❌ Failed to switch worker back to Available:', err)
      }
    }

    // ── Helper: build overflow redirect TwiML (terminal, external) ───────────
    const buildOverflowTwiml = (
      callSid?: string | null,
      callerFrom?: string | null,
    ) => {
      const overflowUrl = new URL(`${appUrl}/api/taskrouter/overflow`)
      if (taskSid) overflowUrl.searchParams.set('taskSid', taskSid)
      if (workspaceSid)
        overflowUrl.searchParams.set('workspaceSid', workspaceSid)
      if (callSid) overflowUrl.searchParams.set('callSid', callSid)
      if (callerFrom) overflowUrl.searchParams.set('callerFrom', callerFrom)
      if (process.env.VERCEL_BYPASS_TOKEN) {
        overflowUrl.searchParams.set(
          'x-vercel-protection-bypass',
          process.env.VERCEL_BYPASS_TOKEN,
        )
      }
      const escapedOverflowUrl = overflowUrl.toString().replace(/&/g, '&amp;')
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${escapedOverflowUrl}</Redirect>
</Response>`
    }

    // ── completed → only trust it if duration confirms a real answer ─────────
    if (!dialCallStatus || dialCallStatus === 'completed') {
      const isGenuineAnswer =
        durationSeconds != null &&
        durationSeconds >= GENUINE_ANSWER_THRESHOLD_SECONDS

      if (isGenuineAnswer) {
        console.log(
          `📞 DialCallStatus="completed" duration=${durationSeconds}s — genuine answer, hanging up cleanly`,
        )

        // Record the Accepted Call Attempt (simultaneous ring is authoritative
        // here, not reservation.accepted which fires early on redirect).
        await recordAcceptedAttempt({ reservationSid, workerSid })

        if (taskSid && workspaceSid) {
          try {
            const task = await client.taskrouter.v1
              .workspaces(workspaceSid)
              .tasks(taskSid)
              .fetch()

            if (
              task.assignmentStatus === 'assigned' ||
              task.assignmentStatus === 'wrapping'
            ) {
              await client.taskrouter.v1
                .workspaces(workspaceSid)
                .tasks(taskSid)
                .update({
                  assignmentStatus: 'completed',
                  reason: 'Simultaneous dial completed successfully',
                })
              console.log(`✅ Task ${taskSid} completed`)
            }
          } catch (taskErr) {
            console.error('❌ Failed to complete task:', taskErr)
          }
        }

        // Switch worker back to Available so they don't stay stuck in Busy
        await switchWorkerToAvailable()

        return new Response(HANGUP_TWIML, {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        })
      }

      const reason =
        durationSeconds === null
          ? 'null duration (rejected during screening)'
          : `duration=${durationSeconds}s < ${GENUINE_ANSWER_THRESHOLD_SECONDS}s (carrier voicemail)`
      console.log(`⚠️ "completed" but ${reason} — treating as no-answer`)
      dialCallStatus = 'no-answer'
    }

    // ── Fetch task attributes for all non-completed cases ────────────────────
    let taskAttributes: Record<string, unknown> = {}
    if (taskSid && workspaceSid) {
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch()

        taskAttributes = JSON.parse(task.attributes || '{}')

        if (
          task.assignmentStatus === 'assigned' ||
          task.assignmentStatus === 'wrapping'
        ) {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: `Simultaneous dial finished: ${dialCallStatus ?? 'unknown'}`,
            })
          console.log(
            `✅ Task ${taskSid} completed (DialCallStatus: ${dialCallStatus})`,
          )
        } else {
          console.log(
            `ℹ️ Task ${taskSid} is already "${task.assignmentStatus}" — skipping completion`,
          )
        }
      } catch (taskErr) {
        console.error(
          '❌ Failed to fetch/complete simultaneous-dial task:',
          taskErr,
        )
      }
    } else {
      console.warn(
        '⚠️ Missing taskSid or workspaceSid — task will not be completed',
      )
    }

    // This Sales Rep's Call Attempt did not result in a genuine answer →
    // record it as Missed (idempotent; suppressed if the rep just rejected).
    await recordMissedAttempt({ reservationSid, workerSid })

    // ── Routing state: have we exhausted the allowed Sales Rep attempts? ──────
    const callSid = (taskAttributes.call_sid as string | undefined) ?? null
    const callerFrom = (taskAttributes.from as string | undefined) ?? null

    const previouslyExcluded = Array.isArray(taskAttributes.excluded_workers)
      ? (taskAttributes.excluded_workers as string[])
      : []
    const excludedWorkers = workerSid
      ? [...new Set([...previouslyExcluded, workerSid])]
      : previouslyExcluded

    const attemptCount = excludedWorkers.length
    const directFallbackOffered =
      taskAttributes.direct_fallback_offered === true

    // Overflow when two distinct Sales Reps have been tried, OR when the single
    // allowed non-owner fallback for a direct (Sales Rep Number) call has been
    // tried. The Overflow Number is terminal — no voicemail afterwards.
    const shouldOverflow = attemptCount >= 2 || directFallbackOffered

    // ── canceled or no-answer → reset worker, then re-enqueue or overflow ─────
    if (dialCallStatus === 'canceled' || dialCallStatus === 'no-answer') {
      // Reset worker to back of queue since they missed the call
      await resetWorkerToBack()

      if (shouldOverflow) {
        console.log(
          `📤 Sales Rep attempts exhausted (count=${attemptCount}, directFallback=${directFallbackOffered}) — routing to overflow`,
        )
        return new Response(buildOverflowTwiml(callSid, callerFrom), {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        })
      }

      console.log(
        '🔄 No answer — re-enqueueing for a distinct Sales Rep, excluded workers:',
        excludedWorkers,
      )

      const waitUrlObj = new URL(`${appUrl}/api/taskrouter/wait`)
      waitUrlObj.searchParams.set('retry', 'true')
      if (process.env.VERCEL_BYPASS_TOKEN) {
        waitUrlObj.searchParams.set(
          'x-vercel-protection-bypass',
          process.env.VERCEL_BYPASS_TOKEN,
        )
      }

      const enqueueActionUrlObj = new URL(
        `${appUrl}/api/taskrouter/enqueue-complete`,
      )
      if (process.env.VERCEL_BYPASS_TOKEN) {
        enqueueActionUrlObj.searchParams.set(
          'x-vercel-protection-bypass',
          process.env.VERCEL_BYPASS_TOKEN,
        )
      }

      const newTaskAttributes = JSON.stringify({
        ...taskAttributes,
        excluded_workers: excludedWorkers,
        attempt_count: attemptCount,
      })

      const escapedWaitUrl = waitUrlObj.toString().replace(/&/g, '&amp;')
      const escapedEnqueueActionUrl = enqueueActionUrlObj
        .toString()
        .replace(/&/g, '&amp;')

      const requeueTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Enqueue workflowSid="${WORKFLOW_SID}"
           action="${escapedEnqueueActionUrl}"
           method="POST"
           waitUrl="${escapedWaitUrl}"
           waitUrlMethod="POST">
    <Task>${newTaskAttributes}</Task>
  </Enqueue>
</Response>`

      return new Response(requeueTwiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // ── busy / failed → terminal overflow ────────────────────────────────────
    console.log(
      `📤 DialCallStatus="${dialCallStatus}" — redirecting to overflow`,
    )
    return new Response(buildOverflowTwiml(callSid, callerFrom), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error) {
    console.error('❌ Simultaneous dial complete handler error:', error)
    return new Response(HANGUP_TWIML, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
