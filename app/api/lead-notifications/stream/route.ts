// Preview-only, page-owned delivery. Every connection starts silently.
import { cookies } from 'next/headers'
import { setTimeout as delay } from 'node:timers/promises'
import { verifyJWT } from '@/lib/auth'
import {
  canStreamSession,
  listNotifications,
  type StreamSession,
} from '@/lib/lead-notifications/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

async function sendSnapshots(
  controller: ReadableStreamDefaultController,
  session: StreamSession,
  signal: AbortSignal,
) {
  const encoder = new TextEncoder()
  const connectionId = crypto.randomUUID()
  const started = Date.now()
  let sequence = 0
  let kind = 'baseline'
  while (!signal.aborted) {
    if (!(await canStreamSession(session))) break
    signal.throwIfAborted()
    if (Date.now() - started >= 240_000) {
      controller.enqueue(encoder.encode('event: rotate\ndata: {}\n\n'))
      break
    }
    const notifications = await listNotifications(session.accountId)
    signal.throwIfAborted()
    const frame = {
      connectionId,
      sequence,
      kind,
      userId: session.accountId,
      notifications,
      serverTime: new Date().toISOString(),
    }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
    sequence++
    kind = 'live'
    await delay(10_000, undefined, { signal })
  }
}

function openStream(request: Request, session: StreamSession) {
  const lifetime = new AbortController()
  const abort = () => lifetime.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  return new ReadableStream({
    async start(controller) {
      try {
        await sendSnapshots(controller, session, lifetime.signal)
      } catch {
        // Closing forces a silent baseline; no error details cross this stream.
      } finally {
        request.signal.removeEventListener('abort', abort)
        if (!lifetime.signal.aborted) controller.close()
      }
    },
    cancel: abort,
  })
}

async function resolveStreamSession(
  request: Request,
): Promise<StreamSession | null> {
  const token = (await cookies()).get('auth_token')?.value
  if (!token) return null
  const session = await verifyJWT(token)
  if (!session) return null
  return {
    token,
    accountId: session.userId,
    localOptIn:
      new URL(request.url).searchParams.get('leadSsePrototype') === 'true',
  }
}

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const session = await resolveStreamSession(request)
  if (!session) return new Response(null, { status: 401, headers })
  if (!(await canStreamSession(session)))
    return new Response(null, { status: 404, headers })
  const stream = openStream(request, session)
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
