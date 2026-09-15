/**
 * TaskRouter Assignment Callback
 *
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 */

import { serverConfig } from '@/lib/config'
import { isValidTwilioWebhook } from '@/lib/twilio-webhook'
import { getUserCellPhoneByEmail } from '@/lib/dal'

function overflowResponse(
  appUrl: string,
  task: { call_sid?: string; from?: string },
  taskSid: string,
  workspaceSid: string,
  availableActivitySid: string,
) {
  if (!task.call_sid) {
    console.error('No call_sid in task attributes; cannot redirect to overflow')
    return Response.json({ instruction: 'reject' })
  }
  const overflowUrl = new URL(`${appUrl}/api/taskrouter/overflow`)
  overflowUrl.searchParams.set('taskSid', taskSid)
  overflowUrl.searchParams.set('workspaceSid', workspaceSid)
  overflowUrl.searchParams.set('callSid', task.call_sid)
  if (task.from) overflowUrl.searchParams.set('callerFrom', task.from)
  serverConfig.app.addVercelBypassToken(overflowUrl)

  // The overflow handler completes the task after fetching its attributes.
  return Response.json({
    instruction: 'redirect',
    call_sid: task.call_sid,
    url: overflowUrl.toString(),
    accept: true,
    post_work_activity_sid: availableActivitySid,
  })
}

function simultaneousRingResponse(
  appUrl: string,
  context: {
    taskSid: string
    workspaceSid: string
    workerSid: string
    reservationSid: string
    availableActivitySid: string
  },
  worker: { email?: string; contact_uri?: string },
  task: { call_sid?: string; from?: string },
  cellPhone: string | null,
) {
  if (!cellPhone) return null
  if (!task.call_sid) {
    console.error('No call_sid in task attributes; using browser conference')
    return null
  }

  const simDialUrl = new URL(`${appUrl}/api/taskrouter/simultaneous-dial`)
  simDialUrl.search = new URLSearchParams({
    taskSid: context.taskSid,
    workspaceSid: context.workspaceSid,
    workerSid: context.workerSid,
    reservationSid: context.reservationSid,
    clientIdentity: (worker.contact_uri ?? `client:${worker.email}`).replace(
      /^client:/,
      '',
    ),
    cellPhone,
    callerFrom: task.from ?? '',
  }).toString()
  serverConfig.app.addVercelBypassToken(simDialUrl)

  return Response.json({
    instruction: 'redirect',
    call_sid: task.call_sid,
    url: simDialUrl.toString(),
    accept: true,
    post_work_activity_sid: context.availableActivitySid,
  })
}

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const formData = await req.formData()

    const taskSid = formData.get('TaskSid') as string
    const reservationSid = formData.get('ReservationSid') as string
    const workerSid = formData.get('WorkerSid') as string
    const workerAttributes = formData.get('WorkerAttributes') as string
    const taskAttributes = formData.get('TaskAttributes') as string

    console.log('═══════════════════════════════════════════')
    console.log('📋 TASKROUTER ASSIGNMENT CALLBACK')
    console.log('═══════════════════════════════════════════')

    let workerAttrs: {
      email?: string
      contact_uri?: string
    } = {}
    let taskAttrs: {
      call_sid?: string
      from?: string
      callType?: 'main' | 'direct'
      primary_owner?: string | null
      excluded_workers?: string[]
      attempt_count?: number
      direct_fallback_offered?: boolean
    } = {}

    try {
      workerAttrs = JSON.parse(workerAttributes || '{}')
      taskAttrs = JSON.parse(taskAttributes || '{}')
    } catch {
      console.error('Failed to parse attributes')
    }

    console.log('═══════════════════════════════════════════')

    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)
    const workspaceSid = formData.get('WorkspaceSid') as string
    const availableActivitySid =
      serverConfig.taskRouter.requireActivitySid('available')

    // ── OVERFLOW (TERMINAL) WORKER ───────────────────────────────────────────
    // The "voicemail@system" worker is the workflow's terminal target reached
    // after the allowed Sales Rep Call Attempts are exhausted. Per Feature 3 it
    // now hands the caller off to the external Overflow Number instead of the
    // Billboard Source AI voicemail flow.
    if (workerAttrs.email === 'voicemail@system') {
      console.log('📤 Terminal worker assigned - redirecting to overflow')
      return overflowResponse(
        appUrl,
        taskAttrs,
        taskSid,
        workspaceSid,
        availableActivitySid,
      )
    }

    // ── MARK SALES REP AS OFFERED ────────────────────────────────────────────
    // Append this worker to excluded_workers so the next routing target
    // (Feature 3) tries a DISTINCT Sales Rep and never re-rings the same one.
    {
      const attemptedWorkers = Array.isArray(taskAttrs.excluded_workers)
        ? taskAttrs.excluded_workers
        : []
      const updatedAttemptedWorkers = [
        ...new Set([...attemptedWorkers, workerSid]),
      ]

      // For a direct (Sales Rep Number) call, the owner is offered first; any
      // other rep offered afterward is the single allowed fallback.
      const isDirectFallback =
        taskAttrs.callType === 'direct' &&
        !!taskAttrs.primary_owner &&
        workerAttrs.email !== taskAttrs.primary_owner

      const updatedTaskAttrs = {
        ...taskAttrs,
        excluded_workers: updatedAttemptedWorkers,
        attempt_count: updatedAttemptedWorkers.length,
        direct_fallback_offered:
          taskAttrs.direct_fallback_offered === true || isDirectFallback,
      }
      taskAttrs = updatedTaskAttrs

      try {
        const { default: twilioModule } = await import('twilio')
        const { accountSid, authToken } =
          serverConfig.twilio.requireAccountCredentials()
        const client = twilioModule(accountSid, authToken)
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({ attributes: JSON.stringify(updatedTaskAttrs) })
      } catch {
        console.error(
          '⚠️ Failed to update task attributes with attempted worker',
        )
      }
    }

    // ── SIMULTANEOUS RING ────────────────────────────────────────────────────
    // Read the account on each offer so saving/removing a cell takes effect
    // without syncing TaskRouter attributes. Legacy worker flags are ignored.
    const cellPhone = await getUserCellPhoneByEmail(workerAttrs.email)
    const simultaneous = simultaneousRingResponse(
      appUrl,
      {
        taskSid,
        workspaceSid,
        workerSid,
        reservationSid,
        availableActivitySid,
      },
      workerAttrs,
      taskAttrs,
      cellPhone,
    )
    if (simultaneous) return simultaneous
    // ── END SIMULTANEOUS RING ────────────────────────────────────────────────

    // ── NORMAL CONFERENCE ────────────────────────────────────────────────────
    const callCompleteUrl = new URL(`${appUrl}/api/taskrouter/call-complete`)
    callCompleteUrl.searchParams.set('taskSid', taskSid)
    callCompleteUrl.searchParams.set('workspaceSid', workspaceSid)
    callCompleteUrl.searchParams.set('workerSid', workerSid)
    callCompleteUrl.searchParams.set('reservationSid', reservationSid)
    serverConfig.app.addVercelBypassToken(callCompleteUrl)

    const instruction = {
      instruction: 'conference',
      to: workerAttrs.contact_uri || `client:${workerAttrs.email}`,
      from: taskAttrs.from || serverConfig.twilio.mainNumber || '+18338547126',
      post_work_activity_sid: availableActivitySid,
      timeout: 15,
      record: 'record-from-answer',
      recording_status_callback: `${appUrl}/api/recordings/call`,
      recording_status_callback_method: 'POST',
      conference_status_callback: callCompleteUrl.toString(),
      conference_status_callback_event: 'start, end, join, leave',
      end_conference_on_exit: true,
      end_conference_on_customer_exit: true,
      reject_pending_reservations: true,
    }

    return Response.json(instruction)
  } catch {
    console.error('❌ Assignment callback failed')
    return new Response('Error', { status: 500 })
  }
}
