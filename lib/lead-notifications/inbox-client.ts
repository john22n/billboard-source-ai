// Unified page-owned client inbox: polling and SSE share one lifecycle,
// one cross-tab sync, one desktop-alert lock, and silent recovery rules.
import { z } from 'zod'
import { createNotificationSync } from './cross-tab'
import { createDesktopAlerts } from './desktop'

const timestamp = z.string().datetime({ offset: true })
const notificationSchema = z.object({
  id: z.string().min(1),
  companyName: z.string(),
  leadUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value)),
  leadCreatedAt: timestamp,
  createdAt: timestamp,
})
const snapshotSchema = z.object({
  userId: z.string().min(1),
  serverTime: timestamp,
  transport: z.enum(['sse', 'polling']).optional(),
  notifications: z
    .array(notificationSchema)
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

export type LeadNotification = z.infer<typeof notificationSchema>
export type InboxConnection =
  | 'loading'
  | 'connected'
  | 'disconnected'
  | 'signed-out'
export interface LeadInboxState {
  notifications: LeadNotification[]
  connection: InboxConnection
  serverOffset: number
}
export interface LeadInboxClientOptions {
  userId: string
  localOptIn?: boolean
  onStateChange: (state: LeadInboxState) => void
}
export interface LeadInboxClient {
  clear: (id: string) => Promise<boolean>
  dispose: () => void
}

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

async function fetchInboxSnapshot(
  userId: string,
  url: string,
  signal: AbortSignal,
): Promise<Snapshot | null> {
  const response = await fetch(url, { cache: 'no-store', signal })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Inbox unavailable')
  const raw: unknown = await response.json()
  if (!raw || typeof raw !== 'object' || Reflect.get(raw, 'userId') !== userId)
    return null
  return snapshotSchema.parse(raw)
}

export function createLeadInboxClient({
  userId,
  localOptIn = false,
  onStateChange,
}: LeadInboxClientOptions): LeadInboxClient {
  const query = localOptIn ? '?leadSsePrototype=true' : ''
  const inboxUrl = `/api/lead-notifications${query}`
  const streamUrl = `/api/lead-notifications/stream${query}`

  let disposed = false
  let mode: 'polling' | 'sse' = 'polling'
  let state: LeadInboxState = {
    notifications: [],
    connection: 'loading',
    serverOffset: 0,
  }

  const cleared = new Set<string>()
  let known = new Set<string>()

  // Polling state
  let pollBusy = false
  let hasPollingBaseline = false
  let lastPollSuccess = 0
  let pollInterval: ReturnType<typeof setInterval> | undefined
  let pollController = new AbortController()

  // SSE state
  let source: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackRequest: AbortController | undefined
  let focusRequest: AbortController | undefined
  let revalidatingSession = false
  let pendingFocusFrame: Frame | null = null
  let retryDelay = 1_000
  let streamEpoch = 0
  let connectionId = ''
  let sequence = -1
  let wall = 0
  let monotonic = 0
  let streamOffset = 0
  let uncertainty = Infinity
  const candidates = new Map<string, { epoch: number; expires: number }>()

  function emit(next: LeadInboxState) {
    state = next
    onStateChange(state)
  }

  function clockIsContinuous(now: number, tick: number) {
    return (
      now - wall < 30_000 &&
      tick - monotonic < 30_000 &&
      now >= wall &&
      Math.abs(now - wall - (tick - monotonic)) <= 2_000
    )
  }

  const desktopAlerts = createDesktopAlerts(userId, (id) => {
    if (cleared.has(id) || !known.has(id)) return true
    if (mode !== 'sse') return false
    const candidate = candidates.get(id)
    return (
      !candidate ||
      candidate.epoch !== streamEpoch ||
      Date.now() > candidate.expires ||
      !clockIsContinuous(Date.now(), performance.now())
    )
  })

  function invalidateAlerts() {
    streamEpoch++
    candidates.clear()
    desktopAlerts.reset()
  }

  function publish(
    snapshot: Pick<Snapshot, 'notifications' | 'serverTime'>,
    connection: InboxConnection = 'connected',
  ) {
    if (disposed) return
    const notifications = snapshot.notifications.filter(
      (item) => !cleared.has(item.id),
    )
    emit({
      notifications,
      connection,
      serverOffset: Date.parse(snapshot.serverTime) - Date.now(),
    })
  }

  function markDisconnected() {
    hasPollingBaseline = false
    if (!disposed && state.connection !== 'disconnected') {
      emit({ ...state, connection: 'disconnected' })
    }
  }

  function stopPolling() {
    clearInterval(pollInterval)
    pollInterval = undefined
    pollController.abort()
    pollController = new AbortController()
    pollBusy = false
  }

  function startPollingInterval() {
    if (pollInterval !== undefined || disposed) return
    pollInterval = setInterval(() => {
      void poll()
    }, 15_000)
  }

  function stopStream() {
    clearTimeout(retryTimer)
    clearTimeout(watchdogTimer)
    retryTimer = undefined
    watchdogTimer = undefined
    source?.close()
    source = null
    sequence = -1
    revalidatingSession = false
    pendingFocusFrame = null
    focusRequest?.abort()
    focusRequest = undefined
    invalidateAlerts()
  }

  function stopFallback() {
    clearTimeout(fallbackTimer)
    fallbackTimer = undefined
    fallbackRequest?.abort()
    fallbackRequest = undefined
  }

  function clearSession() {
    if (disposed) return
    hasPollingBaseline = false
    invalidateAlerts()
    emit({ notifications: [], connection: 'signed-out', serverOffset: 0 })
  }

  function signOut() {
    if (disposed) return
    dispose()
    emit({ notifications: [], connection: 'signed-out', serverOffset: 0 })
  }

  function switchToPolling(snapshot: Snapshot) {
    mode = 'polling'
    stopStream()
    stopFallback()
    hasPollingBaseline = false
    known = new Set(snapshot.notifications.map((item) => item.id))
    publish(snapshot, 'connected')
    startPollingInterval()
    void poll()
  }

  function frameIsContinuous(frame: Frame, now: number, tick: number) {
    const age = now + streamOffset - Date.parse(frame.serverTime)
    return (
      sequence >= 0 &&
      frame.connectionId === connectionId &&
      frame.sequence === sequence + 1 &&
      clockIsContinuous(now, tick) &&
      age >= -uncertainty &&
      age <= 20_000 - uncertainty
    )
  }

  function announceStreamArrivals(
    arrivals: LeadNotification[],
    serverTime: number,
  ) {
    if (uncertainty > 2_500) return
    for (const item of arrivals) {
      candidates.set(item.id, {
        epoch: streamEpoch,
        expires: serverTime - streamOffset + 20_000 - uncertainty,
      })
      void desktopAlerts.show(item)
    }
  }

  function announcePollingArrivals(items: LeadNotification[]) {
    // First/recovery snapshots are silent, including after a suspended tab.
    const arrivals = items.filter((item) => !known.has(item.id))
    const canAlert = hasPollingBaseline && Date.now() - lastPollSuccess < 45_000
    known = new Set(items.map((item) => item.id))
    hasPollingBaseline = true
    lastPollSuccess = Date.now()
    if (canAlert) {
      for (const item of arrivals) void desktopAlerts.show(item)
    }
  }

  function applyFallbackSnapshot(snapshot: Snapshot | null) {
    if (!snapshot) {
      signOut()
      return
    }
    if (snapshot.transport !== 'sse') {
      switchToPolling(snapshot)
      return
    }
    known = new Set(snapshot.notifications.map((item) => item.id))
    publish(snapshot, 'disconnected')
  }

  function scheduleFallbackRetry() {
    if (disposed || mode !== 'sse' || source) return
    fallbackTimer = setTimeout(() => {
      void refreshFallback()
    }, 15_000)
  }

  async function refreshFallback() {
    if (disposed || mode !== 'sse' || fallbackRequest || !navigator.onLine)
      return
    const request = new AbortController()
    fallbackRequest = request
    try {
      const snapshot = await fetchInboxSnapshot(
        userId,
        inboxUrl,
        AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      )
      if (!request.signal.aborted && !disposed) applyFallbackSnapshot(snapshot)
    } catch {
      // Keep the last cards and disconnected status on fallback failure.
    } finally {
      if (fallbackRequest === request) {
        fallbackRequest = undefined
        scheduleFallbackRetry()
      }
    }
  }

  function recoverStream() {
    stopStream()
    if (disposed || mode !== 'sse') return
    markDisconnected()
    void refreshFallback()
    retryTimer = setTimeout(connectStream, retryDelay)
    retryDelay = Math.min(30_000, retryDelay * 2)
  }

  function applyStreamFrame(frame: Frame, opened: number) {
    const now = Date.now()
    const tick = performance.now()
    const serverTime = Date.parse(frame.serverTime)
    const baseline = frame.kind === 'baseline' && frame.sequence === 0
    if (baseline) {
      invalidateAlerts()
      connectionId = frame.connectionId
      uncertainty = (now - opened) / 2
      streamOffset = serverTime - (opened + now) / 2
    } else if (!frameIsContinuous(frame, now, tick)) {
      markDisconnected()
      connectStream()
      return
    }
    const arrivals = frame.notifications.filter((item) => !known.has(item.id))
    known = new Set(frame.notifications.map((item) => item.id))
    sequence = frame.sequence
    wall = now
    monotonic = tick
    retryDelay = 1_000
    stopFallback()
    clearTimeout(watchdogTimer)
    watchdogTimer = setTimeout(recoverStream, 30_000)
    publish(frame, 'connected')
    if (!baseline) announceStreamArrivals(arrivals, serverTime)
  }

  function handleStreamMessage(
    current: EventSource,
    data: string,
    opened: number,
  ) {
    if (disposed || source !== current) return
    const frame = readFrame(data)
    if (!frame) {
      recoverStream()
      return
    }
    if (frame.userId !== userId) {
      signOut()
      return
    }
    if (revalidatingSession) {
      // Hold frames silently until cookie revalidation confirms the session.
      pendingFocusFrame = frame
      return
    }
    applyStreamFrame(frame, opened)
  }

  function connectStream() {
    stopStream()
    if (disposed || mode !== 'sse' || !navigator.onLine) return
    const opened = Date.now()
    let current: EventSource
    try {
      current = new EventSource(streamUrl)
    } catch {
      recoverStream()
      return
    }
    source = current
    watchdogTimer = setTimeout(recoverStream, 30_000)
    current.onmessage = (event) =>
      handleStreamMessage(current, event.data, opened)
    current.addEventListener('rotate', () => {
      if (source === current) connectStream()
    })
    current.onerror = () => {
      if (source !== current) return
      // Retry timers may be delayed while hidden; recovery always stays silent.
      recoverStream()
    }
  }

  function takePendingFocusFrame(): Frame | null {
    const buffered = pendingFocusFrame
    pendingFocusFrame = null
    return buffered
  }

  function applyBufferedFocusFrame(buffered: Frame | null, snapshot: Snapshot) {
    if (
      !buffered ||
      buffered.connectionId !== connectionId ||
      buffered.sequence < sequence
    ) {
      publish(snapshot, 'connected')
      return
    }
    sequence = buffered.sequence
    wall = Date.now()
    monotonic = performance.now()
    known = new Set(buffered.notifications.map((item) => item.id))
    clearTimeout(watchdogTimer)
    watchdogTimer = setTimeout(recoverStream, 30_000)
    publish(buffered, 'connected')
  }

  function applyRevalidatedSnapshot(snapshot: Snapshot | null) {
    const buffered = takePendingFocusFrame()
    if (!snapshot) {
      signOut()
      return
    }
    if (snapshot.transport !== 'sse') {
      switchToPolling(snapshot)
      return
    }
    known = new Set(snapshot.notifications.map((item) => item.id))
    if (!source) {
      publish(snapshot, 'connected')
      connectStream()
      return
    }
    applyBufferedFocusFrame(buffered, snapshot)
  }

  function beginFocusRevalidation() {
    focusRequest?.abort()
    const request = new AbortController()
    focusRequest = request
    revalidatingSession = true
    pendingFocusFrame = null
    // Cancel any pre-focus queued banners while verifying the cookie session.
    invalidateAlerts()
    return request
  }

  async function revalidateStreamSession() {
    if (disposed || mode !== 'sse' || !navigator.onLine) return
    const request = beginFocusRevalidation()
    const isStale = () => request.signal.aborted || disposed
    try {
      const snapshot = await fetchInboxSnapshot(
        userId,
        inboxUrl,
        AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      )
      if (isStale()) return
      revalidatingSession = false
      applyRevalidatedSnapshot(snapshot)
    } catch {
      if (isStale()) return
      revalidatingSession = false
      pendingFocusFrame = null
      recoverStream()
    } finally {
      if (focusRequest === request) focusRequest = undefined
    }
  }

  function applyPollSnapshot(snapshot: Snapshot | null) {
    if (!snapshot) {
      clearSession()
      return
    }
    if (snapshot.transport === 'sse') {
      mode = 'sse'
      hasPollingBaseline = false
      stopPolling()
      invalidateAlerts()
      known = new Set(snapshot.notifications.map((item) => item.id))
      publish(snapshot, 'connected')
      connectStream()
      return
    }
    announcePollingArrivals(snapshot.notifications)
    publish(snapshot, 'connected')
  }

  async function poll() {
    if (pollBusy || disposed || mode !== 'polling') return
    pollBusy = true
    try {
      const snapshot = await fetchInboxSnapshot(
        userId,
        inboxUrl,
        AbortSignal.any([pollController.signal, AbortSignal.timeout(10_000)]),
      )
      if (!disposed && mode === 'polling') applyPollSnapshot(snapshot)
    } catch {
      if (!disposed && mode === 'polling') markDisconnected()
    } finally {
      pollBusy = false
    }
  }

  const sync = createNotificationSync(
    userId,
    (id) => {
      if (disposed) return
      cleared.add(id)
      candidates.delete(id)
      emit({
        ...state,
        notifications: state.notifications.filter((item) => item.id !== id),
      })
    },
    signOut,
  )

  const handleOffline = () => {
    if (disposed) return
    if (mode === 'sse') {
      stopStream()
      stopFallback()
    }
    markDisconnected()
  }

  const handleResume = () => {
    if (disposed) return
    if (mode === 'sse') {
      if (!source || (wall && Date.now() - wall >= 30_000)) connectStream()
    } else {
      void poll()
    }
  }

  const handleSuspend = () => {
    if (disposed) return
    if (mode === 'sse') {
      stopStream()
      stopFallback()
      markDisconnected()
    } else {
      hasPollingBaseline = false
    }
  }

  const handleFocus = () => {
    if (disposed) return
    if (mode === 'sse') void revalidateStreamSession()
    else void poll()
  }

  const handleVisibility = () => {
    if (disposed || mode !== 'polling') return
    void poll()
  }

  window.addEventListener('offline', handleOffline)
  window.addEventListener('online', handleResume)
  window.addEventListener('pagehide', handleSuspend)
  window.addEventListener('pageshow', handleResume)
  window.addEventListener('focus', handleFocus)
  document.addEventListener('freeze', handleSuspend)
  document.addEventListener('resume', handleResume)
  document.addEventListener('visibilitychange', handleVisibility)

  startPollingInterval()
  void poll()

  async function clear(id: string) {
    try {
      const response = await fetch(
        `/api/lead-notifications/${encodeURIComponent(id)}/clear`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!response.ok) return false
      if (!disposed) {
        sync.clear(id)
        if (mode === 'polling') void poll()
      }
      return true
    } catch {
      return false
    }
  }

  function dispose() {
    disposed = true
    stopPolling()
    stopStream()
    stopFallback()
    sync.dispose()
    window.removeEventListener('offline', handleOffline)
    window.removeEventListener('online', handleResume)
    window.removeEventListener('pagehide', handleSuspend)
    window.removeEventListener('pageshow', handleResume)
    window.removeEventListener('focus', handleFocus)
    document.removeEventListener('freeze', handleSuspend)
    document.removeEventListener('resume', handleResume)
    document.removeEventListener('visibilitychange', handleVisibility)
  }

  return { clear, dispose }
}
