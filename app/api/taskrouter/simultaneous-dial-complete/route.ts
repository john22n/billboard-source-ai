import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

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
import {
  buildOverflowRedirectTwiml,
  buildRequeueTwiml,
  computeMissedAttemptRouting,
} from '@/lib/taskrouter-retry-routing'
import { serverConfig } from '@/lib/config'

// Only trust "completed" as a genuine answer if the call lasted at least this long.
// - null duration = rejected during call screening prompt → re-enqueue
// - duration < 4s = carrier voicemail answered → re-enqueue
// - duration >= 4s = real human answered → hang up cleanly
const GENUINE_ANSWER_THRESHOLD_SECONDS = 4

const HANGUP_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

type TwilioClient = ReturnType<typeof twilio>

function twimlResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function logDialResult(
  dialCallStatus: string | null,
  durationSeconds: number | null,
) {
  console.log('═══════════════════════════════════════════')
  console.log('📱 SIMULTANEOUS DIAL COMPLETE')
  console.log('DialCallStatus:', dialCallStatus)
  console.log(
    'DialCallDuration:',
    durationSeconds != null ? `${durationSeconds}s` : 'n/a',
  )
  console.log('═══════════════════════════════════════════')
}

async function resetWorkerToBack(
  client: TwilioClient,
  workspaceSid: string,
  workerSid: string,
  activitySids: { busy: string; available: string },
) {
  if (!workerSid) return

  try {
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .workers(workerSid)
      .update({ activitySid: activitySids.busy })
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .workers(workerSid)
      .update({ activitySid: activitySids.available })
    console.log(
      `✅ Worker ${workerSid} reset to back of queue after missed simultaneous dial`,
    )
  } catch {
    console.error('❌ Failed to reset worker after missed simultaneous dial')
  }
}

async function switchWorkerToAvailable(
  client: TwilioClient,
  workspaceSid: string,
  workerSid: string,
  availableActivitySid: string,
) {
  if (!workerSid) return

  try {
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .workers(workerSid)
      .update({ activitySid: availableActivitySid })
    console.log(
      `✅ Worker ${workerSid} switched back to Available after genuine answer`,
    )
  } catch {
    console.error('❌ Failed to switch worker back to Available')
  }
}

function canCompleteTask(assignmentStatus: string) {
  return assignmentStatus === 'assigned' || assignmentStatus === 'wrapping'
}

async function completeAnsweredTask(
  client: TwilioClient,
  workspaceSid: string,
  taskSid: string | null,
) {
  if (!taskSid) return

  try {
    const task = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .fetch()

    if (!canCompleteTask(task.assignmentStatus)) return

    await client.taskrouter.v1.workspaces(workspaceSid).tasks(taskSid).update({
      assignmentStatus: 'completed',
      reason: 'Simultaneous dial completed successfully',
    })
    console.log(`✅ Task ${taskSid} completed`)
  } catch {
    console.error('❌ Failed to complete task')
  }
}

async function handleGenuineAnswer(options: {
  client: TwilioClient
  workspaceSid: string
  taskSid: string | null
  workerSid: string
  reservationSid: string
  durationSeconds: number
  availableActivitySid: string
}) {
  const {
    client,
    workspaceSid,
    taskSid,
    workerSid,
    reservationSid,
    durationSeconds,
    availableActivitySid,
  } = options

  console.log(
    `📞 DialCallStatus="completed" duration=${durationSeconds}s — genuine answer, hanging up cleanly`,
  )
  // Simultaneous ring is authoritative here because reservation.accepted fires
  // early, when Twilio redirects rather than when the rep actually answers.
  await recordAcceptedAttempt({ reservationSid, workerSid })
  await completeAnsweredTask(client, workspaceSid, taskSid)
  await switchWorkerToAvailable(
    client,
    workspaceSid,
    workerSid,
    availableActivitySid,
  )
}

function normalizeDialCallStatus(
  dialCallStatus: string | null,
  durationSeconds: number | null,
) {
  if (dialCallStatus && dialCallStatus !== 'completed') return dialCallStatus

  const reason =
    durationSeconds === null
      ? 'null duration (rejected during screening)'
      : `duration=${durationSeconds}s < ${GENUINE_ANSWER_THRESHOLD_SECONDS}s (carrier voicemail)`
  console.log(`⚠️ "completed" but ${reason} — treating as no-answer`)
  return 'no-answer'
}

async function fetchAndCompleteMissedTask(
  client: TwilioClient,
  workspaceSid: string,
  taskSid: string | null,
  dialCallStatus: string,
): Promise<Record<string, unknown>> {
  if (!taskSid) {
    console.warn(
      '⚠️ Missing taskSid or workspaceSid — task will not be completed',
    )
    return {}
  }

  try {
    const task = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .fetch()
    const taskAttributes = JSON.parse(task.attributes || '{}')

    if (!canCompleteTask(task.assignmentStatus)) {
      console.log(
        `ℹ️ Task ${taskSid} is already "${task.assignmentStatus}" — skipping completion`,
      )
      return taskAttributes
    }

    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .update({
        assignmentStatus: 'completed',
        reason: `Simultaneous dial finished: ${dialCallStatus}`,
      })
    console.log(
      `✅ Task ${taskSid} completed (DialCallStatus: ${dialCallStatus})`,
    )
    return taskAttributes
  } catch {
    console.error('❌ Failed to fetch/complete simultaneous-dial task')
    return {}
  }
}

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid =
      url.searchParams.get('workspaceSid') ??
      serverConfig.taskRouter.requireWorkspaceSid()
    const workerSid = url.searchParams.get('workerSid') ?? ''
    const reservationSid = url.searchParams.get('reservationSid') ?? ''
    const formData = await req.formData()
    const rawDialCallStatus = formData.get('DialCallStatus') as string | null
    const dialCallDuration = formData.get('DialCallDuration') as string | null
    const durationSeconds = dialCallDuration
      ? parseInt(dialCallDuration, 10)
      : null

    logDialResult(rawDialCallStatus, durationSeconds)

    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    const client = twilio(accountSid, authToken)
    const activitySids = serverConfig.taskRouter.requireActivitySids([
      'busy',
      'available',
    ] as const)

    const isGenuineAnswer =
      (!rawDialCallStatus || rawDialCallStatus === 'completed') &&
      durationSeconds != null &&
      durationSeconds >= GENUINE_ANSWER_THRESHOLD_SECONDS

    if (isGenuineAnswer) {
      await handleGenuineAnswer({
        client,
        workspaceSid,
        taskSid,
        workerSid,
        reservationSid,
        durationSeconds,
        availableActivitySid: activitySids.available,
      })
      return twimlResponse(HANGUP_TWIML)
    }

    const dialCallStatus = normalizeDialCallStatus(
      rawDialCallStatus,
      durationSeconds,
    )
    const taskAttributes = await fetchAndCompleteMissedTask(
      client,
      workspaceSid,
      taskSid,
      dialCallStatus,
    )

    // This Sales Rep's Call Attempt did not result in a genuine answer →
    // record it as Missed (idempotent; suppressed if the rep just rejected).
    await recordMissedAttempt({ reservationSid, workerSid })

    // ── Routing state: have we exhausted the allowed Sales Rep attempts? ──────
    const callSid = (taskAttributes.call_sid as string | undefined) ?? null
    const callerFrom = (taskAttributes.from as string | undefined) ?? null

    // Same two-distinct-reps-then-overflow decision used by the conference path.
    const routing = computeMissedAttemptRouting(taskAttributes, workerSid)

    // ── canceled or no-answer → reset worker, then re-enqueue or overflow ─────
    if (dialCallStatus === 'canceled' || dialCallStatus === 'no-answer') {
      // Reset worker to back of queue since they missed the call
      await resetWorkerToBack(client, workspaceSid, workerSid, activitySids)

      if (routing.shouldOverflow) {
        console.log(
          `📤 Sales Rep attempts exhausted (count=${routing.attemptCount}, directFallback=${routing.directFallbackOffered}) — routing to overflow`,
        )
        return twimlResponse(
          buildOverflowRedirectTwiml(appUrl, {
            taskSid,
            workspaceSid,
            callSid,
            callerFrom,
          }),
        )
      }

      console.log(
        '🔄 No answer — re-enqueueing for a distinct Sales Rep, excluded workers:',
        routing.excludedWorkers,
      )

      return twimlResponse(
        buildRequeueTwiml(appUrl, routing.nextTaskAttributes),
      )
    }

    // ── busy / failed → terminal overflow ────────────────────────────────────
    console.log(
      `📤 DialCallStatus="${dialCallStatus}" — redirecting to overflow`,
    )
    return twimlResponse(
      buildOverflowRedirectTwiml(appUrl, {
        taskSid,
        workspaceSid,
        callSid,
        callerFrom,
      }),
    )
  } catch {
    console.error('❌ Simultaneous dial completion failed')
    return twimlResponse(HANGUP_TWIML)
  }
}
