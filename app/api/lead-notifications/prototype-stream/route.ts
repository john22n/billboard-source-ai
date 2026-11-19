// THROWAWAY local transport experiment. Never enabled in a deployed runtime.
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { setTimeout as delay } from 'node:timers/promises'
import { getDb } from '@/db'
import { user } from '@/db/schema'
import { verifyJWT } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { listNotifications } from '@/lib/lead-notifications/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function prototypeEnabled() {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.PLAYWRIGHT_TEST === '1'
  )
}

async function canRead(token: string, accountId: string) {
  const identity = await verifyJWT(token)
  const db = await getDb()
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, accountId))
  return Boolean(
    identity && account && serverConfig.nutshell.notificationsEnabled,
  )
}

async function sendSnapshots(
  controller: ReadableStreamDefaultController,
  token: string,
  accountId: string,
  signal: AbortSignal,
) {
  const encoder = new TextEncoder()
  const connectionId = crypto.randomUUID()
  const started = Date.now()
  let sequence = 0
  let kind = 'baseline'
  while (!signal.aborted) {
    if (!(await canRead(token, accountId))) break
    if (Date.now() - started >= 240_000) {
      controller.enqueue(encoder.encode('event: rotate\ndata: {}\n\n'))
      break
    }
    const notifications = await listNotifications(accountId)
    const frame = {
      connectionId,
      sequence,
      kind,
      userId: accountId,
      notifications,
      serverTime: new Date().toISOString(),
    }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
    sequence++
    kind = 'live'
    await delay(10_000, undefined, { signal })
  }
}

function openStream(request: Request, token: string, accountId: string) {
  const lifetime = new AbortController()
  const abort = () => lifetime.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  return new ReadableStream({
    async start(controller) {
      try {
        await sendSnapshots(controller, token, accountId, lifetime.signal)
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

async function streamIdentity() {
  const token = (await cookies()).get('auth_token')?.value
  if (!token) return null
  const session = await verifyJWT(token)
  return session ? { token, accountId: session.userId } : null
}

export async function GET(request: Request) {
  if (!prototypeEnabled()) return new Response(null, { status: 404 })
  const identity = await streamIdentity()
  if (!identity) return new Response(null, { status: 401 })
  const stream = openStream(request, identity.token, identity.accountId)
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
