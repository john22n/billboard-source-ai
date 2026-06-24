import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { getSessionWithoutRefresh } from '@/lib/auth'
import { isMissingConfig, serverConfig } from '@/lib/config'

// Voicemail worker email to exclude from the list
const VOICEMAIL_EMAIL = 'voicemail@system'

function firstNameFromEmail(email: string): string {
  const local = email.split('@')[0]
  const first = local.split('.')[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

export async function GET() {
  try {
    const session = await getSessionWithoutRefresh()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let credentials: ReturnType<
      typeof serverConfig.twilio.requireAccountCredentials
    >
    let workspaceSid: string
    try {
      credentials = serverConfig.twilio.requireAccountCredentials()
      workspaceSid = serverConfig.taskRouter.requireWorkspaceSid()
    } catch (error) {
      if (!isMissingConfig(error)) throw error
      console.error(
        '❌ Missing required Twilio config for /api/workers/available:',
        error.message,
      )
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const client = twilio(credentials.accountSid, credentials.authToken)

    // Fetch Available and Busy workers in parallel
    const [availableWorkers, busyWorkers] = await Promise.all([
      client.taskrouter.v1
        .workspaces(workspaceSid)
        .workers.list({ activityName: 'Available' }),
      client.taskrouter.v1
        .workspaces(workspaceSid)
        .workers.list({ activityName: 'Busy' }),
    ])

    // Busy workers are on an active call
    const onCallSids = new Set(busyWorkers.map((w) => w.sid))

    // Merge both lists
    const allWorkers = [...availableWorkers, ...busyWorkers]

    if (allWorkers.length === 0) {
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const allSids = allWorkers.map((w) => w.sid)

    // Fetch matched users to resolve names — exclude voicemail worker
    const matchedUsers = await db
      .select({
        email: user.email,
        taskRouterWorkerSid: user.taskRouterWorkerSid,
      })
      .from(user)
      .where(inArray(user.taskRouterWorkerSid, allSids))

    const sidToUser = new Map(
      matchedUsers
        .filter((u) => u.email !== VOICEMAIL_EMAIL)
        .map((u) => [u.taskRouterWorkerSid, u]),
    )

    // Sort available workers by dateStatusChanged ascending — oldest = longest duration = next in line
    // Busy (on-call) workers appended at the end
    const sortedAvailable = availableWorkers
      .filter((w) => sidToUser.has(w.sid))
      .sort(
        (a, b) =>
          new Date(a.dateStatusChanged).getTime() -
          new Date(b.dateStatusChanged).getTime(),
      )

    const sortedBusy = busyWorkers.filter((w) => sidToUser.has(w.sid))

    const sorted = [...sortedAvailable, ...sortedBusy]

    const workers = sorted.map((w) => ({
      name: firstNameFromEmail(sidToUser.get(w.sid)!.email),
      status: onCallSids.has(w.sid)
        ? ('on_call' as const)
        : ('available' as const),
    }))

    return Response.json(
      { workers },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('❌ Available workers GET error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
