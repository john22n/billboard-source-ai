// THROWAWAY local SSE experiment; selected only by an explicit development URL.
import { createDesktopAlerts } from './desktop'

type Snapshot = {
  userId: string
  serverTime: string
  notifications: {
    id: string
    companyName: string
    leadUrl: string
    leadCreatedAt: string
    createdAt: string
  }[]
}
type Frame = Snapshot & {
  connectionId: string
  sequence: number
  kind: 'baseline' | 'live'
}

export function startPrototypeStream(
  userId: string,
  accept: (snapshot: Snapshot) => void,
  disconnected: () => void,
  isCleared: (id: string) => boolean,
) {
  let source: EventSource | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let epoch = 0
  let known = new Set<string>()
  let connectionId = ''
  let sequence = -1
  let wall = 0
  let monotonic = 0
  let offset = 0
  let uncertainty = Infinity
  const candidates = new Map<string, { epoch: number; expires: number }>()
  const alerts = createDesktopAlerts(userId, (id) => {
    const candidate = candidates.get(id)
    return (
      isCleared(id) ||
      !candidate ||
      candidate.epoch !== epoch ||
      Date.now() > candidate.expires ||
      Date.now() - wall >= 30_000 ||
      performance.now() - monotonic >= 30_000
    )
  })
  function invalidate() {
    epoch++
    sequence = -1
    candidates.clear()
    alerts.reset()
  }
  function stop() {
    clearTimeout(retry)
    source?.close()
    source = null
    invalidate()
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
    return (
      sequence >= 0 &&
      frame.connectionId === connectionId &&
      frame.sequence === sequence + 1 &&
      clockIsContinuous(now, tick) &&
      !(now + offset - Date.parse(frame.serverTime) > 20_000 - uncertainty)
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
  function connect() {
    stop()
    if (disposed || !navigator.onLine) return
    const opened = Date.now()
    const current = new EventSource('/api/lead-notifications/prototype-stream')
    source = current
    current.onmessage = (event) => {
      if (disposed || source !== current) return
      const frame: Frame = JSON.parse(event.data)
      if (frame.userId !== userId) {
        stop()
        disconnected()
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
      accept(frame)
      if (!baseline) announce(arrivals, serverTime)
    }
    current.addEventListener('rotate', () => {
      if (source === current) connect()
    })
    current.onerror = () => {
      if (source !== current) return
      stop()
      disconnected()
      // Retry timers may be delayed while hidden; recovery always stays silent.
      retry = setTimeout(connect, 1_000)
    }
  }
  const suspend = () => {
    stop()
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
    dispose() {
      disposed = true
      stop()
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
