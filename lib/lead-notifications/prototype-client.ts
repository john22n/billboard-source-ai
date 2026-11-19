// SSE remains local opt-in until deployment and native background validation.
import { z } from 'zod'
import { createDesktopAlerts } from './desktop'

const timestamp = z.string().datetime({ offset: true })
const snapshotSchema = z.object({
  userId: z.string().min(1),
  serverTime: timestamp,
  notifications: z
    .array(
      z.object({
        id: z.string().min(1),
        companyName: z.string(),
        leadUrl: z
          .string()
          .url()
          .refine((value) => /^https?:\/\//.test(value)),
        leadCreatedAt: timestamp,
        createdAt: timestamp,
      }),
    )
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
    ),
})
const frameSchema = snapshotSchema
  .extend({
    connectionId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    kind: z.enum(['baseline', 'live']),
  })
  .refine((frame) => (frame.sequence === 0) === (frame.kind === 'baseline'))
type Snapshot = z.infer<typeof snapshotSchema>
type Frame = z.infer<typeof frameSchema>

function readFrame(data: string) {
  try {
    const parsed = frameSchema.safeParse(JSON.parse(data))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function clearChannel(userId: string) {
  try {
    return new BroadcastChannel(`lead-notifications:${userId}`)
  } catch {
    return null
  }
}

async function readFallback(signal: AbortSignal) {
  const response = await fetch('/api/lead-notifications', {
    cache: 'no-store',
    signal,
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Inbox unavailable')
  return snapshotSchema.parse(await response.json())
}

export function startPrototypeStream(
  userId: string,
  accept: (snapshot: Snapshot | null) => void,
  disconnected: () => void,
  isCleared: (id: string) => boolean,
) {
  let source: EventSource | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackRequest: AbortController | undefined
  let retryDelay = 1_000
  let disposed = false
  let epoch = 0
  let known = new Set<string>()
  let connectionId = ''
  let sequence = -1
  let wall = 0
  let monotonic = 0
  let offset = 0
  let uncertainty = Infinity
  let latest: Snapshot | null = null
  const acknowledged = new Set<string>()
  const channel = clearChannel(userId)
  const candidates = new Map<string, { epoch: number; expires: number }>()
  const alerts = createDesktopAlerts(userId, (id) => {
    const candidate = candidates.get(id)
    return (
      isCleared(id) ||
      acknowledged.has(id) ||
      !known.has(id) ||
      !candidate ||
      candidate.epoch !== epoch ||
      Date.now() > candidate.expires ||
      !clockIsContinuous(Date.now(), performance.now())
    )
  })
  function publish(snapshot: Snapshot) {
    latest = {
      ...snapshot,
      notifications: snapshot.notifications.filter(
        (item) => !acknowledged.has(item.id) && !isCleared(item.id),
      ),
    }
    accept(latest)
  }
  function acknowledge(id: string) {
    if (disposed) return
    acknowledged.add(id)
    candidates.delete(id)
    if (latest) publish(latest)
  }
  channel?.addEventListener('message', (event) => {
    const data = z
      .object({ type: z.literal('clear'), id: z.string().min(1) })
      .safeParse(event.data)
    if (data.success) acknowledge(data.data.id)
  })
  function invalidate() {
    epoch++
    sequence = -1
    candidates.clear()
    alerts.reset()
  }
  function stop() {
    clearTimeout(retry)
    clearTimeout(watchdog)
    source?.close()
    source = null
    invalidate()
  }
  function stopFallback() {
    clearTimeout(fallbackTimer)
    fallbackRequest?.abort()
    fallbackRequest = undefined
  }
  function signOut() {
    disposed = true
    stop()
    stopFallback()
    channel?.close()
    latest = null
    accept(null)
  }
  function acceptFallback(snapshot: Snapshot | null, request: AbortController) {
    if (request.signal.aborted || disposed) return
    if (!snapshot || snapshot.userId !== userId) {
      signOut()
      return
    }
    publish(snapshot)
    disconnected()
  }
  async function refreshFallback() {
    if (disposed || fallbackRequest || !navigator.onLine) return
    const request = new AbortController()
    fallbackRequest = request
    try {
      const snapshot = await readFallback(
        AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      )
      acceptFallback(snapshot, request)
    } catch {
      // Keep the last cards and disconnected status on fallback failure.
    } finally {
      if (fallbackRequest === request) {
        fallbackRequest = undefined
        fallbackTimer = setTimeout(() => {
          void refreshFallback()
        }, 15_000)
      }
    }
  }
  function clockIsContinuous(now: number, tick: number) {
    return (
      now - wall < 30_000 &&
      tick - monotonic < 30_000 &&
      now >= wall &&
      Math.abs(now - wall - (tick - monotonic)) <= 2_000
    )
  }
  function frameIsContinuous(frame: Frame, now: number, tick: number) {
    const age = now + offset - Date.parse(frame.serverTime)
    return (
      sequence >= 0 &&
      frame.connectionId === connectionId &&
      frame.sequence === sequence + 1 &&
      clockIsContinuous(now, tick) &&
      age >= -uncertainty &&
      age <= 20_000 - uncertainty
    )
  }
  function announce(arrivals: Snapshot['notifications'], serverTime: number) {
    if (uncertainty > 2_500) return
    for (const item of arrivals) {
      candidates.set(item.id, {
        epoch,
        expires: serverTime - offset + 20_000 - uncertainty,
      })
      void alerts.show(item)
    }
  }
  function recover() {
    stop()
    if (disposed) return
    disconnected()
    void refreshFallback()
    retry = setTimeout(connect, retryDelay)
    retryDelay = Math.min(30_000, retryDelay * 2)
  }
  function connect() {
    stop()
    if (disposed || !navigator.onLine) return
    const opened = Date.now()
    let current: EventSource
    try {
      current = new EventSource('/api/lead-notifications/prototype-stream')
    } catch {
      recover()
      return
    }
    source = current
    watchdog = setTimeout(recover, 30_000)
    current.onmessage = (event) => {
      if (disposed || source !== current) return
      const frame = readFrame(event.data)
      if (!frame) {
        recover()
        return
      }
      if (frame.userId !== userId) {
        signOut()
        return
      }
      const now = Date.now()
      const tick = performance.now()
      const serverTime = Date.parse(frame.serverTime)
      const baseline = frame.kind === 'baseline' && frame.sequence === 0
      if (baseline) {
        invalidate()
        connectionId = frame.connectionId
        uncertainty = (now - opened) / 2
        offset = serverTime - (opened + now) / 2
      } else if (!frameIsContinuous(frame, now, tick)) {
        disconnected()
        connect()
        return
      }
      const arrivals = frame.notifications.filter((item) => !known.has(item.id))
      known = new Set(frame.notifications.map((item) => item.id))
      sequence = frame.sequence
      wall = now
      monotonic = tick
      retryDelay = 1_000
      stopFallback()
      clearTimeout(watchdog)
      watchdog = setTimeout(recover, 30_000)
      publish(frame)
      if (!baseline) announce(arrivals, serverTime)
    }
    current.addEventListener('rotate', () => {
      if (source === current) connect()
    })
    current.onerror = () => {
      if (source !== current) return
      // Retry timers may be delayed while hidden; recovery always stays silent.
      recover()
    }
  }
  const suspend = () => {
    if (disposed) return
    stop()
    stopFallback()
    disconnected()
  }
  const resume = () => {
    if (!source || (wall && Date.now() - wall >= 30_000)) connect()
  }
  window.addEventListener('offline', suspend)
  window.addEventListener('online', resume)
  window.addEventListener('pagehide', suspend)
  window.addEventListener('pageshow', resume)
  window.addEventListener('focus', resume)
  document.addEventListener('freeze', suspend)
  document.addEventListener('resume', resume)
  connect()
  return {
    refresh: connect,
    clear(id: string) {
      acknowledge(id)
      try {
        channel?.postMessage({ type: 'clear', id })
      } catch {
        /* Other tabs still reconcile through their next snapshot. */
      }
    },
    dispose() {
      disposed = true
      stop()
      stopFallback()
      channel?.close()
      window.removeEventListener('offline', suspend)
      window.removeEventListener('online', resume)
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('focus', resume)
      document.removeEventListener('freeze', suspend)
      document.removeEventListener('resume', resume)
    },
  }
}
