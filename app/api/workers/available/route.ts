import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSessionWithoutRefresh } from '@/lib/auth'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID

export async function GET() {
  try {
    const session = await getSessionWithoutRefresh()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!ACCOUNT_SID || !AUTH_TOKEN || !WORKSPACE_SID) {
      console.error('❌ Missing required Twilio env vars for /api/workers/available')
      return Response.json(
        { count: 0 },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const [currentUser] = await db
      .select({ taskRouterWorkerSid: user.taskRouterWorkerSid })
      .from(user)
      .where(eq(user.email, session.email))

    const client = twilio(ACCOUNT_SID as string, AUTH_TOKEN as string)

    const twilioWorkers = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.list({ activityName: 'Available' })

    const count = twilioWorkers.filter(
      (w) => w.sid !== currentUser?.taskRouterWorkerSid,
    ).length

    return Response.json(
      { count },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('❌ Available workers GET error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
