import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 * Completes the task when the conference ends.
 * If the conference ended without being answered, redirects caller to voicemail.
 * Worker reset is handled by reservation.canceled in events/route.ts.
 */
import twilio from 'twilio'
import { z } from 'zod'
import { recordMissedAttempt } from '@/lib/call-attempt-outcomes'
import { computeMissedAttemptRouting } from '@/lib/taskrouter-retry-routing'
import { serverConfig } from '@/lib/config'
import { readCallOffer, recordCallAnswer } from '@/lib/taskrouter-call-state'

type TwilioClient = ReturnType<typeof twilio>

const providerErrorSchema = z.object({
  status: z.number().optional(),
  code: z.number().optional(),
})
const handoffSchema = z.object({
  conferenceSid: z.string(),
  delivered: z.boolean(),
  leaseUntil: z.number(),
})

type ConferenceEnd = {
  client: TwilioClient
  conferenceSid: string
  taskSid: string
  workspaceSid: string
  workerSid: string | null
  reservationSid: string
  appUrl: string
}

function providerError(error: unknown) {
  return providerErrorSchema.safeParse(error).data ?? {}
}

function taskVersion(client: TwilioClient) {
  // Never silently turn a conditional task write into an unconditional one.
  return z.string().min(1).parse(client.httpClient.lastResponse?.headers.etag)
}

function shouldDeliverHandoff(
  value: unknown,
  conferenceSid: string,
  status: string,
) {
  const handoff = handoffSchema.safeParse(value).data
  if (!handoff || handoff.conferenceSid !== conferenceSid)
    return isActiveTask(status)
  if (handoff.delivered) return false
  if (!['assigned', 'wrapping', 'completed'].includes(status)) return false
  // Concurrent deliveries wait; an abandoned lease expires after one minute.
  if (handoff.leaseUntil > Date.now())
    throw Object.assign(new Error('Conference handoff is in progress'), {
      status: 503,
    })
  return true
}

function logConferenceEvent(details: {
  statusCallbackEvent: string
  conferenceSid: string
  callSid: string
  taskSid: string | null
  workerSid: string | null
}) {
  console.log('═══════════════════════════════════════════')
  console.log('📞 CONFERENCE STATUS CALLBACK')
  console.log('StatusCallbackEvent:', details.statusCallbackEvent)
  console.log('═══════════════════════════════════════════')
}

function isActiveTask(assignmentStatus: string) {
  return assignmentStatus === 'assigned' || assignmentStatus === 'wrapping'
}

async function redirectActiveCaller(
  client: TwilioClient,
  callerCallSid: string,
  retryUrl: URL,
) {
  try {
    const callerCall = await client.calls(callerCallSid).fetch()
    if (callerCall.status !== 'in-progress') {
      console.log(
        `ℹ️ Caller already hung up (status: ${callerCall.status}) — skipping redirect`,
      )
      return
    }

    await client.calls(callerCallSid).update({
      url: retryUrl.toString(),
      method: 'POST',
    })
    console.log('✅ Caller redirected to retry-or-overflow')
  } catch (error) {
    // The caller can hang up between fetch and update. Twilio rejects a
    // redirect of a finished call with 21220; no further action is needed.
    if (providerError(error).code === 21220) {
      console.log('ℹ️ Caller hung up during redirect — skipping redirect')
      return
    }
    throw error
  }
}

function buildRetryUrl(options: {
  appUrl: string
  taskSid: string
  workspaceSid: string
  workerSid: string | null
  callerCallSid: string
  callerFrom?: string
}) {
  const retryUrl = new URL(`${options.appUrl}/api/taskrouter/retry-or-overflow`)
  retryUrl.searchParams.set('taskSid', options.taskSid)
  retryUrl.searchParams.set('workspaceSid', options.workspaceSid)
  if (options.workerSid) {
    retryUrl.searchParams.set('workerSid', options.workerSid)
  }
  retryUrl.searchParams.set('callSid', options.callerCallSid)
  if (options.callerFrom) {
    retryUrl.searchParams.set('callerFrom', options.callerFrom)
  }
  serverConfig.app.addVercelBypassToken(retryUrl)
  return retryUrl
}

async function claimConferenceHandoff(options: ConferenceEnd) {
  const { client, workspaceSid, taskSid, conferenceSid, workerSid } = options
  const task = client.taskrouter.v1.workspaces(workspaceSid).tasks(taskSid)
  const current = await task.fetch()
  const etag = taskVersion(client)
  const attributes = JSON.parse(current.attributes || '{}')
  const active = isActiveTask(current.assignmentStatus)
  // Participants only lists active calls, not historical answers.
  if (readCallOffer(attributes)?.status === 'answered') {
    if (active)
      await task.update({
        ifMatch: etag,
        assignmentStatus: 'completed',
        reason: 'Conference ended',
      })
    return null
  }
  if (
    !shouldDeliverHandoff(
      attributes.conference_handoff,
      conferenceSid,
      current.assignmentStatus,
    )
  )
    return null
  const routing = computeMissedAttemptRouting(attributes, workerSid)
  const claimed: Record<string, unknown> & {
    conference_handoff: z.infer<typeof handoffSchema>
  } = {
    ...routing.nextTaskAttributes,
    conference_handoff: {
      conferenceSid,
      delivered: false,
      leaseUntil: Date.now() + 60_000,
    },
  }
  await task.update({ ifMatch: etag, attributes: JSON.stringify(claimed) })
  return {
    task,
    attributes: claimed,
    etag: taskVersion(client),
    active,
    shouldOverflow: routing.shouldOverflow,
  }
}

async function deliverConferenceHandoff(
  options: ConferenceEnd,
  claim: NonNullable<Awaited<ReturnType<typeof claimConferenceHandoff>>>,
) {
  const { client, workerSid, reservationSid } = options
  const { task, attributes } = claim
  let etag = claim.etag
  let delivered = false
  try {
    // Twilio requires separate requests for attributes and terminal status.
    if (claim.active) {
      await task.update({
        ifMatch: etag,
        assignmentStatus: 'completed',
        reason: claim.shouldOverflow
          ? 'Conference ended unanswered — overflow'
          : 'Conference ended unanswered — retrying distinct rep',
      })
      etag = taskVersion(client)
    }
    if (workerSid) await recordMissedAttempt({ reservationSid, workerSid })
    const callerCallSid = attributes.call_sid as string | undefined
    if (callerCallSid) {
      await redirectActiveCaller(
        client,
        callerCallSid,
        buildRetryUrl({
          ...options,
          callerCallSid,
          callerFrom: attributes.from as string | undefined,
        }),
      )
    } else {
      console.log(
        '⚠️ Conference ended without a callerCallSid — skipping redirect',
      )
    }
    delivered = true
    await task.update({
      ifMatch: etag,
      attributes: JSON.stringify({
        ...attributes,
        conference_handoff: {
          ...attributes.conference_handoff,
          delivered: true,
          leaseUntil: 0,
        },
      }),
    })
  } catch (error) {
    // Do not clear another callback's lease or a concurrently saved answer.
    // If the redirect succeeded but acknowledgement failed, retain the lease;
    // cross-API delivery is not an exactly-once transaction.
    if (!delivered)
      await task
        .update({
          ifMatch: etag,
          attributes: JSON.stringify({
            ...attributes,
            conference_handoff: {
              ...attributes.conference_handoff,
              leaseUntil: 0,
            },
          }),
        })
        .catch(() => {})
    throw error
  }
}

async function handleConferenceEnd(options: ConferenceEnd) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let claimed = false
    try {
      const claim = await claimConferenceHandoff(options)
      if (!claim) return
      claimed = true
      await deliverConferenceHandoff(options, claim)
      return
    } catch (error) {
      const { status } = providerError(error)
      // Re-read on a version conflict, or a task transition rejected before
      // claiming. Never turn a call-redirect error into a successful callback.
      if (attempt === 2 || !(status === 412 || (!claimed && status === 400)))
        throw error
    }
  }
}

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const formData = await req.formData()
    const statusCallbackEvent = formData.get('StatusCallbackEvent') as string
    const conferenceSid = formData.get('ConferenceSid') as string
    const callSid = formData.get('CallSid') as string

    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid =
      url.searchParams.get('workspaceSid') ||
      serverConfig.taskRouter.requireWorkspaceSid()
    const workerSid = url.searchParams.get('workerSid')
    const reservationSid = url.searchParams.get('reservationSid') ?? ''
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    const client = twilio(accountSid, authToken)

    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)

    logConferenceEvent({
      statusCallbackEvent,
      conferenceSid,
      callSid,
      taskSid,
      workerSid,
    })

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid')
      return new Response('Missing parameters', { status: 400 })
    }

    if (statusCallbackEvent === 'conference-start') {
      await recordCallAnswer(req, formData, 'browser')
    } else if (statusCallbackEvent === 'conference-end') {
      await handleConferenceEnd({
        client,
        conferenceSid,
        taskSid,
        workspaceSid,
        workerSid,
        reservationSid,
        appUrl,
      })
    } else {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`)
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    // Provider messages may contain phone numbers or request URLs. Retain only
    // numeric diagnostics so unexpected failures remain actionable and private.
    console.error('❌ Conference status callback failed', providerError(error))
    return new Response('Error', { status: 500 })
  }
}
