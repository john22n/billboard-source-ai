import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'

const CENTRAL_TIME_ZONE = 'America/Chicago'
const LOGOUT_HOUR = 19

type WorkerAttributes = {
  email?: string
  role?: string
  available?: boolean
  [key: string]: unknown
}

function getWorkerAttributes(attributes: string): WorkerAttributes {
  try {
    return JSON.parse(attributes) as WorkerAttributes
  } catch {
    return {}
  }
}

function isVoicemailWorker(attributes: WorkerAttributes) {
  return (
    attributes.role === 'voicemail' || attributes.email === 'voicemail@system'
  )
}

function isCentralLogoutHour(now = new Date()) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now)

  return Number(hour) === LOGOUT_HOUR
}

async function setHumanWorkersOffline() {
  const { accountSid, authToken } =
    serverConfig.twilio.requireAccountCredentials()
  const workspaceSid = serverConfig.taskRouter.requireWorkspaceSid()
  const offlineActivitySid =
    serverConfig.taskRouter.requireActivitySid('offline')
  const workspace = twilio(accountSid, authToken).taskrouter.v1.workspaces(
    workspaceSid,
  )
  const workers = await workspace.workers.list({ limit: 1000 })
  const humanWorkers = workers
    .map((worker) => ({
      worker,
      attributes: getWorkerAttributes(worker.attributes),
    }))
    .filter(({ attributes }) => !isVoicemailWorker(attributes))

  const results = await Promise.allSettled(
    humanWorkers.map(async ({ worker, attributes }) => {
      if (worker.activitySid === offlineActivitySid) return false

      await workspace.workers(worker.sid).update({
        activitySid: offlineActivitySid,
        attributes: JSON.stringify({ ...attributes, available: false }),
      })
      return true
    }),
  )

  const failedCount = results.filter(
    (result) => result.status === 'rejected',
  ).length
  const updatedCount = results.filter(
    (result) => result.status === 'fulfilled' && result.value,
  ).length

  return {
    updatedCount,
    alreadyOfflineCount: humanWorkers.length - updatedCount,
    failedCount,
  }
}

function cronErrorResponse(error: unknown) {
  if (isMissingConfig(error)) {
    return NextResponse.json(configErrorResponseBody(error), { status: 500 })
  }
  console.error('Failed to set TaskRouter workers offline')
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

function offlineResultResponse(
  result: Awaited<ReturnType<typeof setHumanWorkersOffline>>,
) {
  if (result.failedCount > 0) {
    console.error('Failed to set one or more TaskRouter workers offline')
    return NextResponse.json({ success: false, ...result }, { status: 500 })
  }

  console.log(
    `Set ${result.updatedCount} TaskRouter workers offline at 7 PM Central`,
  )
  return NextResponse.json({ success: true, ...result })
}

export async function GET(request: NextRequest) {
  try {
    const cronSecret = serverConfig.cron.requireSecret()
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Vercel cron schedules use UTC. The route runs at both possible UTC hours
    // for 7 PM Central, then skips the invocation that does not match CST/CDT.
    if (!isCentralLogoutHour()) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const result = await setHumanWorkersOffline()
    return offlineResultResponse(result)
  } catch (error) {
    return cronErrorResponse(error)
  }
}
