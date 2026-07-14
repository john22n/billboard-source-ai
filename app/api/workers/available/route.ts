import twilio from 'twilio'
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

    // Resolve names from TaskRouter attributes so this frequently refreshed
    // endpoint does not consume Neon compute hours.
    const emailBySid = new Map<string, string>()
    for (const worker of allWorkers) {
      let email = worker.friendlyName
      try {
        const attributes = JSON.parse(worker.attributes || '{}') as {
          email?: unknown
        }
        if (typeof attributes.email === 'string') email = attributes.email
      } catch {
        // Fall back to the worker's email-based friendly name.
      }

      if (email.includes('@') && email !== VOICEMAIL_EMAIL) {
        emailBySid.set(worker.sid, email)
      }
    }

    // Sort available workers by dateStatusChanged ascending — oldest = longest duration = next in line
    // Busy (on-call) workers appended at the end
    const sortedAvailable = availableWorkers
      .filter((w) => emailBySid.has(w.sid))
      .sort(
        (a, b) =>
          new Date(a.dateStatusChanged).getTime() -
          new Date(b.dateStatusChanged).getTime(),
      )

    const sortedBusy = busyWorkers.filter((w) => emailBySid.has(w.sid))

    const sorted = [...sortedAvailable, ...sortedBusy]

    const workers = sorted.map((w) => ({
      name: firstNameFromEmail(emailBySid.get(w.sid)!),
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
