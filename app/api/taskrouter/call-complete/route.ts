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
import { recordMissedAttempt } from '@/lib/call-attempt-outcomes'
import { computeMissedAttemptRouting } from '@/lib/taskrouter-retry-routing'
import { serverConfig } from '@/lib/config'

type TwilioClient = ReturnType<typeof twilio>

function logConferenceEvent(details: {
  statusCallbackEvent: string
  conferenceSid: string
  callSid: string
  taskSid: string | null
  workerSid: string | null
}) {
  console.log('═══════════════════════════════════════════')
  console.log('📞 CONFERENCE STATUS CALLBACK')
  console.log('═══════════════════════════════════════════')
  console.log('StatusCallbackEvent:', details.statusCallbackEvent)
  console.log('ConferenceSid:', details.conferenceSid)
  console.log('CallSid:', details.callSid)
  console.log('TaskSid:', details.taskSid)
  console.log('WorkerSid:', details.workerSid)
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
    console.log(`✅ Caller ${callerCallSid} redirected to retry-or-overflow`)
  } catch (redirectErr) {
    console.error(
      '❌ Failed to redirect caller to retry-or-overflow:',
      redirectErr,
    )
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

async function handleConferenceEnd(options: {
  client: TwilioClient
  conferenceSid: string
  taskSid: string
  workspaceSid: string
  workerSid: string | null
  reservationSid: string
  appUrl: string
}) {
  const {
    client,
    conferenceSid,
    taskSid,
    workspaceSid,
    workerSid,
    reservationSid,
    appUrl,
  } = options

  try {
    const task = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .fetch()
    const taskAttributes = JSON.parse(task.attributes || '{}')
    const callerCallSid = taskAttributes.call_sid as string | undefined

    // Twilio can redeliver conference-end. Only the first active delivery may
    // perform side effects, preventing duplicate redirects and re-enqueues.
    if (!isActiveTask(task.assignmentStatus)) {
      console.log(
        `ℹ️ Task is ${task.assignmentStatus}, skipping conference-end side effects`,
      )
      return
    }

    const participants = await client
      .conferences(conferenceSid)
      .participants.list()
    const wasAnswered = participants.length >= 2
    console.log(`📊 Participants count: ${participants.length}`)
    console.log(`📊 wasAnswered: ${wasAnswered}`)

    if (wasAnswered) {
      await client.taskrouter.v1
        .workspaces(workspaceSid)
        .tasks(taskSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'Conference ended',
        })
      console.log('✅ Conference was answered — task completed, no retry')
      return
    }

    console.log(
      '📤 Conference ended unanswered — advancing to next Sales Rep or overflow',
    )
    if (workerSid) {
      await recordMissedAttempt({ reservationSid, workerSid })
    }

    const routing = computeMissedAttemptRouting(taskAttributes, workerSid)
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .update({
        attributes: JSON.stringify(routing.nextTaskAttributes),
        assignmentStatus: 'completed',
        reason: routing.shouldOverflow
          ? 'Conference ended unanswered — overflow'
          : 'Conference ended unanswered — retrying distinct rep',
      })
    console.log(
      `✅ Task ${taskSid} completed (attempt ${routing.attemptCount}, shouldOverflow=${routing.shouldOverflow})`,
    )

    if (!callerCallSid) {
      console.log(
        '⚠️ Conference ended unanswered but no callerCallSid available',
      )
      return
    }

    const retryUrl = buildRetryUrl({
      appUrl,
      taskSid,
      workspaceSid,
      workerSid,
      callerCallSid,
      callerFrom: taskAttributes.from as string | undefined,
    })
    await redirectActiveCaller(client, callerCallSid, retryUrl)
  } catch (error) {
    console.error('❌ Failed to handle conference-end:', error)
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

    if (statusCallbackEvent === 'conference-end') {
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
    console.error('❌ Conference status callback error:', error)
    return new Response('Error', { status: 500 })
  }
}
