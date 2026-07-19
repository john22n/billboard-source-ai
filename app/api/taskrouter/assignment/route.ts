/**
 * TaskRouter Assignment Callback
 *
 * Called when TaskRouter needs to assign a task to a worker.
 * Returns instructions to dial the worker's browser client.
 */

import twilio from 'twilio'
import { serverConfig } from '@/lib/config'
import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

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
    console.log('TaskSid:', taskSid)
    console.log('ReservationSid:', reservationSid)
    console.log('WorkerSid:', workerSid)

    let workerAttrs: {
      email?: string
      contact_uri?: string
      simultaneous_ring?: boolean
      cell_phone?: string
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

    console.log('Worker email:', workerAttrs.email)
    console.log('Call from:', taskAttrs.from)
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

      const overflowUrl = new URL(`${appUrl}/api/taskrouter/overflow`)
      overflowUrl.searchParams.set('taskSid', taskSid)
      overflowUrl.searchParams.set('workspaceSid', workspaceSid)
      if (taskAttrs.call_sid)
        overflowUrl.searchParams.set('callSid', taskAttrs.call_sid)
      if (taskAttrs.from)
        overflowUrl.searchParams.set('callerFrom', taskAttrs.from)
      serverConfig.app.addVercelBypassToken(overflowUrl)

      const callSid = taskAttrs.call_sid
      if (!callSid) {
        console.error('❌ No call_sid in task attributes - cannot redirect')
        return Response.json({ instruction: 'reject' })
      }

      const instruction = {
        instruction: 'redirect',
        call_sid: callSid,
        url: overflowUrl.toString(),
        accept: true,
        post_work_activity_sid: availableActivitySid,
      }

      console.log('📞 Redirect instruction:', instruction)

      // Note: the /overflow handler completes the task; we do not complete it
      // here so the redirect can fetch attributes if needed.
      return Response.json(instruction)
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
      } catch (err) {
        console.error(
          '⚠️ Failed to update task attributes with attempted worker:',
          err,
        )
      }
    }

    // ── SIMULTANEOUS RING ────────────────────────────────────────────────────
    if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {
      console.log(
        '📱 Worker has simultaneous_ring=true — using parallel dial instead of conference',
      )

      const callSid = taskAttrs.call_sid

      if (!callSid) {
        console.error(
          '❌ No call_sid in task attributes — falling through to conference for simultaneous-ring worker',
        )
      } else {
        const clientIdentity = (
          workerAttrs.contact_uri ?? `client:${workerAttrs.email}`
        ).replace(/^client:/, '')

        const simDialUrl = new URL(`${appUrl}/api/taskrouter/simultaneous-dial`)
        simDialUrl.searchParams.set('taskSid', taskSid)
        simDialUrl.searchParams.set('workspaceSid', workspaceSid)
        simDialUrl.searchParams.set('clientIdentity', clientIdentity)
        simDialUrl.searchParams.set('cellPhone', workerAttrs.cell_phone)
        simDialUrl.searchParams.set('callerFrom', taskAttrs.from ?? '')
        simDialUrl.searchParams.set('workerSid', workerSid)
        simDialUrl.searchParams.set('reservationSid', reservationSid)
        serverConfig.app.addVercelBypassToken(simDialUrl)

        const simRingInstruction = {
          instruction: 'redirect',
          call_sid: callSid,
          url: simDialUrl.toString(),
          accept: true,
          post_work_activity_sid: availableActivitySid,
        }

        console.log('📞 Simultaneous ring redirect instruction:', {
          ...simRingInstruction,
          url: simRingInstruction.url.replace(
            /cellPhone=[^&]+/,
            'cellPhone=***',
          ),
        })
        return Response.json(simRingInstruction)
      }
    }
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

    console.log('📞 Conference instruction:', instruction)

    return Response.json(instruction)
  } catch (error) {
    console.error('❌ Assignment callback error:', error)
    return new Response('Error', { status: 500 })
  }
}
