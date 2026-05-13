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

    // Fetch available workers and assigned tasks in parallel
    const [availableWorkers, assignedTasks] = await Promise.all([
      client.taskrouter.v1.workspaces(WORKSPACE_SID).workers.list({ activityName: 'Available' }),
      client.taskrouter.v1.workspaces(WORKSPACE_SID).tasks.list({ assignmentStatus: ['assigned'] }),
    ])

    console.log('✅ Available workers from Twilio:', availableWorkers.length)
    console.log('✅ Assigned tasks:', assignedTasks.length)

    // For each assigned task fetch its accepted reservations to get the worker SID
    const reservationResults = await Promise.all(
      assignedTasks.map((task) =>
        client.taskrouter.v1
          .workspaces(WORKSPACE_SID)
          .tasks(task.sid)
          .reservations.list({ reservationStatus: 'accepted' })
      )
    )

    // Build a set of worker SIDs currently on an active call
    const onCallSids = new Set(reservationResults.flat().map((r) => r.workerSid))

    console.log('✅ On-call worker SIDs:', [...onCallSids])

    // Exclude the currently logged-in user
    const otherWorkers = availableWorkers.filter(
      (w) => w.sid !== currentUser?.taskRouterWorkerSid,
    )

    if (otherWorkers.length === 0) {
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const otherSids = otherWorkers.map((w) => w.sid)

    const matchedUsers = await db
      .select({ email: user.email, taskRouterWorkerSid: user.taskRouterWorkerSid })
      .from(user)
      .where(inArray(user.taskRouterWorkerSid, otherSids))

    const sidToEmail = new Map(
      matchedUsers.map((u) => [u.taskRouterWorkerSid, u.email]),
    )

    // Sort by dateStatusChanged ascending (oldest = next in round-robin)
    const sorted = otherWorkers
      .filter((w) => sidToEmail.has(w.sid))
      .sort((a, b) => new Date(a.dateUpdated).getTime() - new Date(b.dateUpdated).getTime())

    const workers = sorted.map((w) => ({
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