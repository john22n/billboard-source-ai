import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { getSessionWithoutRefresh } from '@/lib/auth'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!

function emailToDisplayName(email: string): string {
  const local = email.split('@')[0]
  const parts = local.split('.')
  const first = parts[0]
    ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
    : ''
  const lastInitial = parts[1]
    ? ` ${parts[1].charAt(0).toUpperCase()}.`
    : ''
  return `${first}${lastInitial}`
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
        { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
      )
    }

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

    const twilioWorkers = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.list({ activityName: 'Available' })

    if (twilioWorkers.length === 0) {
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
      )
    }

    const workerSids = twilioWorkers.map((w) => w.sid)

    const matchedUsers = await db
      .select({ email: user.email, taskRouterWorkerSid: user.taskRouterWorkerSid })
      .from(user)
      .where(inArray(user.taskRouterWorkerSid, workerSids))

    const sidToEmail = new Map(
      matchedUsers.map((u) => [u.taskRouterWorkerSid, u.email]),
    )

    const workers = twilioWorkers.map((w) => {
      const email = sidToEmail.get(w.sid)
      const displayName = email ? emailToDisplayName(email) : w.friendlyName
      return { sid: w.sid, displayName }
    })

    return Response.json(
      { workers },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
    )
  } catch (error) {
    console.error('❌ Available workers GET error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
