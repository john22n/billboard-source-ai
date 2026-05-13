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

    // Fetch available workers, assigned tasks, and recently completed tasks in parallel
    const [availableWorkers, assignedTasks, completedTasks] = await Promise.all([
      client.taskrouter.v1.workspaces(WORKSPACE_SID).workers.list({ activityName: 'Available' }),
      client.taskrouter.v1.workspaces(WORKSPACE_SID).tasks.list({ assignmentStatus: ['assigned'] }),
      client.taskrouter.v1.workspaces(WORKSPACE_SID).tasks.list({ assignmentStatus: ['completed'], pageSize: 50 }),
    ])

    // For each assigned task fetch its reservations to find who's on a call
    // For each completed task fetch its reservations to find who last took a call
    const [assignedReservations, completedReservations] = await Promise.all([
      Promise.all(
        assignedTasks.map((task) =>
          client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .tasks(task.sid)
            .reservations.list()
            .then((res) => res.filter((r) => r.reservationStatus === 'accepted'))
        )
      ),
      Promise.all(
        completedTasks.map((task) =>
          client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .tasks(task.sid)
            .reservations.list()
            .then((res) => res
              .filter((r) => r.reservationStatus === 'accepted')
              .map((r) => ({ workerSid: r.workerSid, dateUpdated: task.dateUpdated }))
            )
        )
      ),
    ])

    // Build set of worker SIDs currently on an active call
    const onCallSids = new Set(assignedReservations.flat().map((r) => r.workerSid))

    // Build map of workerSid -> most recent completed call time
    const lastCallMap = new Map<string, Date>()
    for (const group of completedReservations.flat()) {
      const existing = lastCallMap.get(group.workerSid)
      const current = new Date(group.dateUpdated)
      if (!existing || current > existing) {
        lastCallMap.set(group.workerSid, current)
      }
    }

    console.log('✅ On-call SIDs:', [...onCallSids])
    console.log('✅ Last call map:', [...lastCallMap.entries()].map(([sid, date]) => ({ sid, date })))

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

    // Sort by last completed call time ascending
    // Workers with no completed calls go first (they haven't taken any calls yet)
    const sorted = otherWorkers
      .filter((w) => sidToEmail.has(w.sid))
      .sort((a, b) => {
        const aTime = lastCallMap.get(a.sid)?.getTime() ?? 0
        const bTime = lastCallMap.get(b.sid)?.getTime() ?? 0
        return aTime - bTime
      })

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