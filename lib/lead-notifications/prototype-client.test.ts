// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startPrototypeStream } from './prototype-client'
import { createNotificationSync } from './cross-tab'

class Stream extends EventTarget {
  static current: Stream
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    super()
    Stream.current = this
  }
  close() {}
  send(data: unknown) {
    this.onmessage?.(
      new MessageEvent('message', {
        data: typeof data === 'string' ? data : JSON.stringify(data),
      }),
    )
  }
}
const banners: string[] = []
class Banner {
  static permission = 'granted'
  constructor(title: string) {
    banners.push(title)
  }
  close() {}
}
let client: ReturnType<typeof startPrototypeStream> | undefined
let peer: ReturnType<typeof startPrototypeStream> | undefined
class Channel extends EventTarget {
  static all = new Set<Channel>()
  constructor(readonly name: string) {
    super()
    Channel.all.add(this)
  }
  postMessage(data: unknown) {
    for (const other of Channel.all)
      if (other !== this && other.name === this.name)
        other.dispatchEvent(new MessageEvent('message', { data }))
  }
  close() {
    Channel.all.delete(this)
  }
}
const accepted = vi.fn()
const disconnected = vi.fn()
function item(id: string) {
  return {
    id,
    companyName: `Company ${id}`,
    leadUrl: `https://app.nutshell.com/leads/${id}`,
    leadCreatedAt: '2026-11-19T00:00:00Z',
    createdAt: '2026-11-19T00:00:00Z',
  }
}
function frame(
  sequence: number,
  ids: string[] = [],
  connectionId = 'connection-1',
) {
  return {
    userId: 'rep-1',
    transport: 'sse',
    serverTime: new Date().toISOString(),
    connectionId,
    sequence,
    kind: sequence ? 'live' : 'baseline',
    notifications: ids.map(item),
  }
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'],
  })
  vi.setSystemTime(new Date('2026-11-19T01:00:00Z'))
  localStorage.clear()
  banners.length = 0
  accepted.mockClear()
  disconnected.mockClear()
  vi.stubGlobal('EventSource', Stream)
  vi.stubGlobal('BroadcastChannel', Channel)
  vi.stubGlobal('Notification', Banner)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: { request: async (_name: string, run: () => void) => run() },
  })
})
afterEach(() => {
  client?.dispose()
  peer?.dispose()
  peer = undefined
  client = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('retains the inbox and silently rebaselines after malformed stream data', async () => {
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  Stream.current.send(frame(0, ['old']))
  expect(() => Stream.current.send('{broken')).not.toThrow()
  expect(
    accepted.mock.lastCall?.[0].notifications.map((n: { id: string }) => n.id),
  ).toEqual(['old'])
  expect(disconnected).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  Stream.current.send(frame(0, ['old', 'recovered'], 'connection-2'))
  expect(banners).toEqual([])
  await vi.advanceTimersByTimeAsync(10000)
  Stream.current.send(frame(1, ['old', 'recovered', 'fresh'], 'connection-2'))
  await Promise.resolve()
  expect(banners).toEqual(['Company fresh'])
})

it.each(['removed', 'clock jump', 'disposed'] as const)(
  'cancels a queued alert when %s before the desktop lock is acquired',
  async (reason) => {
    const pending: (() => void)[] = []
    vi.stubGlobal('navigator', {
      onLine: true,
      locks: {
        request: async (_name: string, run: () => void) => {
          pending.push(run)
        },
      },
    })
    client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
    Stream.current.send(frame(0))
    await vi.advanceTimersByTimeAsync(10000)
    Stream.current.send(frame(1, ['queued']))
    if (reason === 'removed') {
      await vi.advanceTimersByTimeAsync(10000)
      Stream.current.send(frame(2))
    } else if (reason === 'clock jump') {
      vi.setSystemTime(new Date('2026-11-19T00:55:00Z'))
    } else client.dispose()
    pending.forEach((run) => run())
    expect(banners).toEqual([])
    expect(localStorage.getItem('lead-alerts:rep-1:shown')).toBeNull()
  },
)

it.each(['error', 'silent stream'] as const)(
  'silently refreshes cards when the stream has %s',
  async (failure) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(frame(0, ['fallback']))),
    )
    client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
    Stream.current.send(frame(0, ['old']))
    if (failure === 'error') Stream.current.onerror?.()
    await vi.advanceTimersByTimeAsync(30_001)
    expect(
      accepted.mock.lastCall?.[0].notifications.map(
        (n: { id: string }) => n.id,
      ),
    ).toEqual(['fallback'])
    expect(banners).toEqual([])
    client.dispose()
    const count = accepted.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(accepted.mock.calls.length).toBe(count)
  },
)

it('clears recipient data and stops delivery after authentication expires', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  )
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  Stream.current.send(frame(0, ['old']))
  const previous = Stream.current
  previous.onerror?.()
  await vi.advanceTimersByTimeAsync(1000)
  expect(accepted.mock.lastCall?.[0]).toBeNull()
  previous.send(frame(1, ['other']))
  window.dispatchEvent(new Event('focus'))
  expect(accepted.mock.lastCall?.[0]).toBeNull()
  expect(banners).toEqual([])
})

it('discards buffered frames from an interrupted connection and rebaselines silently', async () => {
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  const interrupted = Stream.current
  interrupted.send(frame(0, ['old']))
  await vi.advanceTimersByTimeAsync(31_000)
  interrupted.send(frame(1, ['buffered']))
  interrupted.send(frame(2, ['buffered', 'also-buffered']))
  Stream.current.send(frame(0, ['buffered', 'also-buffered'], 'connection-2'))
  expect(banners).toEqual([])
  await vi.advanceTimersByTimeAsync(10000)
  Stream.current.send(
    frame(1, ['buffered', 'also-buffered', 'fresh'], 'connection-2'),
  )
  expect(banners).toEqual(['Company fresh'])
})

it.each(['timestamp', 'duplicates', 'unsafe URL'] as const)(
  'rejects malformed %s without replacing cards',
  (problem) => {
    client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
    Stream.current.send(frame(0, ['old']))
    const invalid = frame(1, ['bad'])
    if (problem === 'timestamp') invalid.serverTime = 'not-a-date'
    if (problem === 'duplicates') invalid.notifications.push(item('bad'))
    if (problem === 'unsafe URL')
      invalid.notifications[0].leadUrl = 'javascript:alert(1)'
    expect(() => Stream.current.send(invalid)).not.toThrow()
    expect(
      accepted.mock.lastCall?.[0].notifications.map(
        (n: { id: string }) => n.id,
      ),
    ).toEqual(['old'])
    expect(banners).toEqual([])
  },
)

it('propagates acknowledged Clear to another tab and cancels its queued banner', async () => {
  const pending: (() => void)[] = []
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: async (_name: string, run: () => void) => {
        pending.push(run)
      },
    },
  })
  const cleared = new Set<string>()
  const peerCleared = new Set<string>()
  const pageSync = createNotificationSync(
    'rep-1',
    (id) => cleared.add(id),
    () => {},
  )
  const peerSync = createNotificationSync(
    'rep-1',
    (id) => peerCleared.add(id),
    () => {},
  )
  client = startPrototypeStream('rep-1', accepted, disconnected, (id) =>
    cleared.has(id),
  )
  const first = Stream.current
  first.send(frame(0))
  const peerAccepted = vi.fn()
  peer = startPrototypeStream('rep-1', peerAccepted, disconnected, (id) =>
    peerCleared.has(id),
  )
  Stream.current.send(frame(0))
  await vi.advanceTimersByTimeAsync(10000)
  first.send(frame(1, ['clear-me']))
  Stream.current.send(frame(1, ['clear-me']))
  // The page still broadcasts after its SSE transport has been disposed.
  client.dispose()
  pageSync.clear('clear-me')
  pending.forEach((run) => run())
  expect(banners).toEqual([])
  // An already in-flight snapshot cannot resurrect the acknowledged card.
  Stream.current.send(frame(2, ['clear-me']))
  expect(peerAccepted.mock.lastCall?.[0].notifications).toEqual([])
  pageSync.dispose()
  peerSync.dispose()
})

it('rejects a future-dated live frame rather than extending its alert lifetime', async () => {
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  Stream.current.send(frame(0, ['old']))
  await vi.advanceTimersByTimeAsync(10000)
  Stream.current.send({
    ...frame(1, ['future']),
    serverTime: '2026-11-19T01:01:00Z',
  })
  expect(banners).toEqual([])
  expect(
    accepted.mock.lastCall?.[0].notifications.map((n: { id: string }) => n.id),
  ).toEqual(['old'])
})

it('ignores a late fallback response after a new live baseline', async () => {
  let finish!: (value: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    ),
  )
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  Stream.current.send(frame(0, ['old']))
  Stream.current.onerror?.()
  await vi.advanceTimersByTimeAsync(1000)
  Stream.current.send(frame(0, ['new'], 'connection-2'))
  finish(Response.json(frame(0, ['stale'])))
  await vi.advanceTimersByTimeAsync(0)
  expect(
    accepted.mock.lastCall?.[0].notifications.map((n: { id: string }) => n.id),
  ).toEqual(['new'])
  expect(banners).toEqual([])
})

it('stops reconnecting and hands off silently when SSE eligibility is withdrawn', async () => {
  const usePolling = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        ...frame(0, ['recovered']),
        transport: 'polling',
      }),
    ),
  )
  client = startPrototypeStream(
    'rep-1',
    accepted,
    disconnected,
    () => false,
    usePolling,
  )
  const previous = Stream.current
  previous.send(frame(0, ['old']))
  previous.onerror?.()
  await vi.advanceTimersByTimeAsync(60_000)
  window.dispatchEvent(new Event('focus'))
  expect(usePolling).toHaveBeenCalledExactlyOnceWith()
  expect(Stream.current).toBe(previous)
  expect(banners).toEqual([])
  expect(
    accepted.mock.lastCall?.[0].notifications.map((n: { id: string }) => n.id),
  ).toEqual(['recovered'])
})

it('keeps arrivals in a rotation gap silent but alerts on subsequent live arrivals', async () => {
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  const previous = Stream.current
  previous.send(frame(0))
  previous.dispatchEvent(new Event('rotate'))
  previous.send(frame(1, ['gap']))
  Stream.current.send(frame(0, ['gap'], 'connection-2'))
  expect(banners).toEqual([])
  await vi.advanceTimersByTimeAsync(10000)
  Stream.current.send(frame(1, ['gap', 'fresh'], 'connection-2'))
  expect(banners).toEqual(['Company fresh'])
})

it('revalidates a fresh stream on focus and discards frames from the previous session', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  )
  client = startPrototypeStream('rep-1', accepted, disconnected, () => false)
  const previous = Stream.current
  previous.send(frame(0, ['old']))
  window.dispatchEvent(new Event('focus'))
  previous.send(frame(1, ['old', 'must-not-alert']))
  await vi.advanceTimersByTimeAsync(0)
  expect(accepted.mock.lastCall?.[0]).toBeNull()
  expect(banners).toEqual([])
})
