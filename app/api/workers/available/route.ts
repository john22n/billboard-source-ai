import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { getSessionWithoutRefresh } from '@/lib/auth'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID

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

    if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID) {
      console.error('❌ Missing required Twilio env vars for /api/workers/available')
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const client = twilio(ACCOUNT_SID as string, AUTH_TOKEN as string)

    // Fetch Available and Busy workers in parallel
    const [availableWorkers, busyWorkers] = await Promise.all([
      client.taskrouter.v1.workspaces(WORKSPACE_SID).workers.list({ activityName: 'Available' }),
      client.taskrouter.v1.workspaces(WORKSPACE_SID).workers.list({ activityName: 'Busy' }),
    ])

    // Busy workers are on an active call
    const onCallSids = new Set(busyWorkers.map((w) => w.sid))

    // Merge both lists — Available + Busy
    const allWorkers = [...availableWorkers, ...busyWorkers]

    if (allWorkers.length === 0) {
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const allSids = allWorkers.map((w) => w.sid)

    // Fetch matched users including lastCallAt for round-robin sort
    const matchedUsers = await db
      .select({
        email: user.email,
        taskRouterWorkerSid: user.taskRouterWorkerSid,
        lastCallAt: user.lastCallAt,
      })
      .from(user)
      .where(inArray(user.taskRouterWorkerSid, allSids))

    const sidToUser = new Map(
      matchedUsers.map((u) => [u.taskRouterWorkerSid, u]),
    )

    // Sort available workers by lastCallAt ascending — if null fall back to dateStatusChanged
    // Busy (on-call) workers are appended at the end
    const sortedAvailable = availableWorkers
      .filter((w) => sidToUser.has(w.sid))
      .sort((a, b) => {
        const aTime = sidToUser.get(a.sid)?.lastCallAt?.getTime()
          ?? new Date(a.dateStatusChanged).getTime()
        const bTime = sidToUser.get(b.sid)?.lastCallAt?.getTime()
          ?? new Date(b.dateStatusChanged).getTime()
        return aTime - bTime
      })

    const sortedBusy = busyWorkers.filter((w) => sidToUser.has(w.sid))

    const sorted = [...sortedAvailable, ...sortedBusy]

    const workers = sorted.map((w) => ({
      name: firstNameFromEmail(sidToUser.get(w.sid)!.email),
      status: onCallSids.has(w.sid) ? ('on_call' as const) : ('available' as const),
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