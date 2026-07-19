/**
 * Retry-or-Overflow TwiML Handler (Feature 3 — normal conference path)
 *
 * The conference assignment instruction ACCEPTS the reservation, so TaskRouter
 * will not advance to the workflow's second target on a worker no-answer. When
 * a conference ends unanswered, call-complete completes that accepted task and
 * redirects the caller's live leg here. This handler decides — using the same
 * rule as the simultaneous-ring path — whether to re-enqueue for a distinct
 * Sales Rep or hand off to the terminal Overflow Number.
 *
 * The caller leg reaches this endpoint via a Twilio call redirect, so it must
 * return TwiML (not a TaskRouter assignment instruction).
 */
import twilio from 'twilio'
import {
  buildOverflowRedirectTwiml,
  buildRequeueTwiml,
  computeMissedAttemptRouting,
} from '@/lib/taskrouter-retry-routing'
import { serverConfig } from '@/lib/config'
import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

const XML_HEADERS = { 'Content-Type': 'text/xml' }

async function handle(req: Request): Promise<Response> {
  if (!(await isValidTwilioWebhook(req))) {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(req.url)
  const taskSid = url.searchParams.get('taskSid')
  const workspaceSid =
    url.searchParams.get('workspaceSid') ??
    serverConfig.taskRouter.requireWorkspaceSid()
  const workerSid = url.searchParams.get('workerSid')
  const fallbackCallSid = url.searchParams.get('callSid')
  const fallbackCallerFrom = url.searchParams.get('callerFrom')

  const appUrl = serverConfig.app.baseUrlFromRequest(req.url)

  console.log('═══════════════════════════════════════════')
  console.log('🔁 RETRY-OR-OVERFLOW')
  console.log('═══════════════════════════════════════════')

  // Can't identify the task → fail terminally to overflow rather than strand.
  if (!taskSid) {
    console.error('❌ retry-or-overflow: missing taskSid — routing to overflow')
    return new Response(
      buildOverflowRedirectTwiml(appUrl, {
        taskSid,
        workspaceSid,
        callSid: fallbackCallSid,
        callerFrom: fallbackCallerFrom,
      }),
      { status: 200, headers: XML_HEADERS },
    )
  }

  let taskAttributes: Record<string, unknown> = {}
  try {
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    const client = twilio(accountSid, authToken)
    const task = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .fetch()
    taskAttributes = JSON.parse(task.attributes || '{}')
  } catch (err) {
    console.error(
      '❌ retry-or-overflow: failed to fetch task — routing to overflow:',
      err,
    )
    return new Response(
      buildOverflowRedirectTwiml(appUrl, {
        taskSid,
        workspaceSid,
        callSid: fallbackCallSid,
        callerFrom: fallbackCallerFrom,
      }),
      { status: 200, headers: XML_HEADERS },
    )
  }

  const routing = computeMissedAttemptRouting(taskAttributes, workerSid)
  const callSid =
    (taskAttributes.call_sid as string | undefined) ?? fallbackCallSid
  const callerFrom =
    (taskAttributes.from as string | undefined) ?? fallbackCallerFrom

  if (routing.shouldOverflow) {
    console.log(
      `📤 Sales Rep attempts exhausted (count=${routing.attemptCount}, directFallback=${routing.directFallbackOffered}) — routing to overflow`,
    )
    return new Response(
      buildOverflowRedirectTwiml(appUrl, {
        taskSid,
        workspaceSid,
        callSid,
        callerFrom,
      }),
      { status: 200, headers: XML_HEADERS },
    )
  }

  console.log(
    '🔄 Re-enqueueing for a distinct Sales Rep, excluded workers:',
    routing.excludedWorkers,
  )
  return new Response(buildRequeueTwiml(appUrl, routing.nextTaskAttributes), {
    status: 200,
    headers: XML_HEADERS,
  })
}

export async function POST(req: Request) {
  return handle(req)
}

export async function GET(req: Request) {
  return handle(req)
}
