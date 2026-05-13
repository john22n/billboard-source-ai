import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
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

    const [currentUser] = await db
      .select({ taskRouterWorkerSid: user.taskRouterWorkerSid })
      .from(user)
      .where(eq(user.email, session.email))

    const client = twilio(ACCOUNT_SID as string, AUTH_TOKEN as string)

    // Fetch Available and Busy workers in parallel
    const [availableWorkers, busyWorkers] = await Promise.all([
      client.taskrouter.v1.workspaces(WORKSPACE_SID).workers.list({ activityName: 'Available' }),
      client.taskrouter.v1.workspaces(WORKSPACE_SID).workers.list({ activityName: 'Busy' }),
    ])

    console.log('✅ Available workers from Twilio:', availableWorkers.length)
    console.log('✅ Available worker SIDs:', availableWorkers.map((w) => w.sid))
    console.log('✅ Current user SID:', currentUser?.taskRouterWorkerSid)

    // Busy workers are on an active call
    const onCallSids = new Set(busyWorkers.map((w) => w.sid))

    // Available workers sorted ascending by dateStatusChanged (oldest = next in round-robin)
    // Busy (on-call) workers appended at the end
    const sortedAvailable = availableWorkers
      .filter((w) => w.sid !== currentUser?.taskRouterWorkerSid)
      .sort((a, b) => new Date(a.dateStatusChanged).getTime() - new Date(b.dateStatusChanged).getTime())

    const filteredBusy = busyWorkers.filter(
      (w) => w.sid !== currentUser?.taskRouterWorkerSid,
    )

    const allWorkers = [...sortedAvailable, ...filteredBusy]

    console.log('✅ Other workers after filter:', allWorkers.length)

    if (allWorkers.length === 0) {
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const allSids = allWorkers.map((w) => w.sid)

    const matchedUsers = await db
      .select({ email: user.email, taskRouterWorkerSid: user.taskRouterWorkerSid })
      .from(user)
      .where(inArray(user.taskRouterWorkerSid, allSids))

    console.log('✅ Matched users from DB:', matchedUsers.length)

    const sidToEmail = new Map(
      matchedUsers.map((u) => [u.taskRouterWorkerSid, u.email]),
    )

    const workers = allWorkers
      .filter((w) => sidToEmail.has(w.sid))
      .map((w) => ({
        name: firstNameFromEmail(sidToEmail.get(w.sid)!),
        status: onCallSids.has(w.sid) ? ('on_call' as const) : ('available' as const),
      }))

    console.log('✅ Final workers returned:', workers)

    return Response.json(
      { workers },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('❌ Available workers GET error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}