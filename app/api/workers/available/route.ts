import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { getSessionWithoutRefresh } from '@/lib/auth'
import { isMissingConfig, serverConfig } from '@/lib/config'
import { readCallOffer, type CurrentCall } from '@/lib/taskrouter-call-state'

const VOICEMAIL_EMAIL = 'voicemail@system'
const CACHE_TTL_MS = 1_000

interface WorkerEntry {
  id: string
  name: string
  status: 'available' | 'ringing' | 'busy'
}

interface SortableWorkerEntry extends WorkerEntry {
  dateStatusChanged: Date
}

interface UserRoster {
  emails: Set<string>
  workerSids: Set<string>
}

interface WorkerSnapshot {
  workers: WorkerEntry[]
  calls: Map<string, CurrentCall>
}

let cachedWorkers: { snapshot: WorkerSnapshot; expiresAt: number } | null = null
let pendingWorkers: Promise<WorkerSnapshot> | null = null

function firstNameFromEmail(email: string): string {
  const local = email.split('@')[0]
  const first = local.split('.')[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function workerEmail(worker: { friendlyName: string; attributes: string }) {
  try {
    const attributes = JSON.parse(worker.attributes || '{}') as {
      email?: unknown
    }
    if (typeof attributes.email === 'string') return attributes.email
  } catch {
    // Fall back to the worker's email-based friendly name.
  }
  return worker.friendlyName
}

function workerStatus(
  worker: { activitySid: string; activityName: string },
  activitySids: { available: string; busy: string },
): WorkerEntry['status'] | null {
  if (worker.activitySid === activitySids.available) return 'available'
  if (worker.activitySid === activitySids.busy) return 'busy'
  return null
}

function isRosterMember(workerSid: string, email: string, roster: UserRoster) {
  return roster.workerSids.has(workerSid) || roster.emails.has(email)
}

function isDisplayableEmail(email: string) {
  if (!email.includes('@')) return false
  return email !== VOICEMAIL_EMAIL
}

function rosterWorker(
  worker: {
    sid: string
    friendlyName: string
    attributes: string
    activitySid: string
    activityName: string
    dateStatusChanged: Date
  },
  roster: UserRoster,
  activitySids: { available: string; busy: string },
  calls: Map<string, CurrentCall>,
): SortableWorkerEntry | null {
  const call = calls.get(worker.sid)
  const status = call
    ? call.status === 'ringing'
      ? 'ringing'
      : 'busy'
    : workerStatus(worker, activitySids)
  if (!status) return null

  const email = workerEmail(worker).toLowerCase()
  if (!isRosterMember(worker.sid, email, roster)) return null
  if (!isDisplayableEmail(email)) return null

  return {
    id: worker.sid,
    name: firstNameFromEmail(email),
    status,
    dateStatusChanged: worker.dateStatusChanged,
  }
}

async function fetchWorkers(): Promise<WorkerSnapshot> {
  if (cachedWorkers && cachedWorkers.expiresAt > Date.now()) {
    return cachedWorkers.snapshot
  }

  if (pendingWorkers) return pendingWorkers

  pendingWorkers = (async () => {
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    const workspaceSid = serverConfig.taskRouter.requireWorkspaceSid()
    const activitySids = serverConfig.taskRouter.requireActivitySids([
      'available',
      'busy',
    ] as const)
    const client = twilio(accountSid, authToken)

    const [twilioWorkers, users, tasks] = await Promise.all([
      client.taskrouter.v1
        .workspaces(workspaceSid)
        .workers.list({ pageSize: 1_000 }),
      db
        .select({
          email: user.email,
          taskRouterWorkerSid: user.taskRouterWorkerSid,
        })
        .from(user),
      client.taskrouter.v1.workspaces(workspaceSid).tasks.list({
        assignmentStatus: ['reserved', 'assigned'],
        pageSize: 1_000,
      }),
    ])

    const calls = new Map<string, CurrentCall>()
    for (const task of tasks) {
      try {
        const attributes = JSON.parse(task.attributes || '{}')
        const offer = readCallOffer(attributes)
        if (!offer || typeof attributes.call_sid !== 'string') continue
        calls.set(offer.workerSid, {
          taskSid: task.sid,
          callSid: attributes.call_sid,
          callerFrom:
            typeof attributes.from === 'string' ? attributes.from : '',
          status: offer.status,
          channel: offer.channel,
        })
      } catch {
        // Legacy/non-voice tasks do not have this application's call offer.
      }
    }

    const roster = {
      emails: new Set(users.map((entry) => entry.email.toLowerCase())),
      workerSids: new Set(
        users
          .map((entry) => entry.taskRouterWorkerSid)
          .filter((sid): sid is string => Boolean(sid)),
      ),
    }
    const relevantWorkers = twilioWorkers
      .map((worker) => rosterWorker(worker, roster, activitySids, calls))
      .filter((worker): worker is SortableWorkerEntry => worker !== null)

    const availableWorkers = relevantWorkers
      .filter((worker) => worker.status === 'available')
      .sort(
        (a, b) =>
          new Date(a.dateStatusChanged).getTime() -
          new Date(b.dateStatusChanged).getTime(),
      )
    const busyWorkers = relevantWorkers.filter(
      (worker) => worker.status !== 'available',
    )
    const workers = [...availableWorkers, ...busyWorkers].map(
      ({ id, name, status }) => ({ id, name, status }),
    )

    // Keep caller numbers inside the server-side snapshot. A response only
    // includes the caller belonging to its authenticated rep, never the roster.
    for (const worker of twilioWorkers) {
      const call = calls.get(worker.sid)
      if (call) calls.set(workerEmail(worker).toLowerCase(), call)
    }
    const snapshot = { workers, calls }
    cachedWorkers = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS }
    return snapshot
  })()

  try {
    return await pendingWorkers
  } finally {
    pendingWorkers = null
  }
}

export async function GET() {
  try {
    const session = await getSessionWithoutRefresh()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workers, calls } = await fetchWorkers()
    const currentCall =
      calls.get(session.taskRouterWorkerSid || session.email.toLowerCase()) ??
      null

    return Response.json(
      { workers, currentCall },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    if (isMissingConfig(error)) {
      if (process.env.NODE_ENV === 'development') {
        return Response.json(
          { workers: [] },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      }
      console.error(
        '❌ Missing required Twilio config for /api/workers/available:',
        error.message,
      )
      return Response.json(
        { error: 'Worker availability is unavailable' },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    }
    console.error('❌ Available workers GET error:', error)
    return Response.json(
      { error: 'Internal error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
