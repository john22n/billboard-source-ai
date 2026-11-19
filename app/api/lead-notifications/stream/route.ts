// Preview-only, page-owned delivery. Every connection starts silently.
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

async function canRead(token: string, accountId: string, localOptIn: boolean) {
  const identity = await verifyJWT(token)
  if (identity?.userId !== accountId) return false
  const db = await getDb()
  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, accountId))
  return Boolean(
    account &&
    serverConfig.leadNotifications.canStream(account.email, localOptIn),
  )
}

async function sendSnapshots(
  controller: ReadableStreamDefaultController,
  token: string,
  accountId: string,
  signal: AbortSignal,
  localOptIn: boolean,
) {
  const encoder = new TextEncoder()
  const connectionId = crypto.randomUUID()
  const started = Date.now()
  let sequence = 0
  let kind = 'baseline'
  while (!signal.aborted) {
    if (!(await canRead(token, accountId, localOptIn))) break
    signal.throwIfAborted()
    if (Date.now() - started >= 240_000) {
      controller.enqueue(encoder.encode('event: rotate\ndata: {}\n\n'))
      break
    }
    const notifications = await listNotifications(accountId)
    signal.throwIfAborted()
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

function openStream(
  request: Request,
  token: string,
  accountId: string,
  localOptIn: boolean,
) {
  const lifetime = new AbortController()
  const abort = () => lifetime.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  return new ReadableStream({
    async start(controller) {
      try {
        await sendSnapshots(
          controller,
          token,
          accountId,
          lifetime.signal,
          localOptIn,
        )
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
  const headers = { 'Cache-Control': 'private, no-store' }
  const identity = await streamIdentity()
  if (!identity) return new Response(null, { status: 401, headers })
  const localOptIn =
    new URL(request.url).searchParams.get('leadSsePrototype') === 'true'
  if (!(await canRead(identity.token, identity.accountId, localOptIn)))
    return new Response(null, { status: 404, headers })
  const stream = openStream(
    request,
    identity.token,
    identity.accountId,
    localOptIn,
  )
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
