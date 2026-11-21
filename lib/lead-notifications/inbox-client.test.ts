// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createLeadInboxClient,
  type LeadInboxClient,
  type LeadInboxState,
} from './inbox-client'

class Stream extends EventTarget {
  static current: Stream
  static count = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor() {
    super()
    Stream.count++
    Stream.current = this
  }
  close() {
    this.closed = true
  }
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

let client: LeadInboxClient | undefined
let peer: LeadInboxClient | undefined

function item(id: string) {
  return {
    id,
    companyName: `Company ${id}`,
    leadUrl: `https://app.nutshell.com/leads/${id}`,
    leadCreatedAt: '2026-11-19T00:00:00Z',
    createdAt: '2026-11-19T00:00:00Z',
  }
}

function snapshot(
  ids: string[] = [],
  transport: 'sse' | 'polling' = 'sse',
  userId = 'rep-1',
) {
  return {
    userId,
    transport,
    serverTime: new Date().toISOString(),
    notifications: ids.map(item),
  }
}

function frame(
  sequence: number,
  ids: string[] = [],
  connectionId = 'connection-1',
) {
  return {
    ...snapshot(ids, 'sse'),
    connectionId,
    sequence,
    kind: sequence ? 'live' : 'baseline',
  }
}

async function startSseClient(
  initialIds: string[] = [],
  nextFetch?: ReturnType<typeof vi.fn>,
) {
  const states: LeadInboxState[] = []
  const fetchMock = nextFetch ?? vi.fn().mockRejectedValue(new Error('offline'))
  fetchMock.mockResolvedValueOnce(Response.json(snapshot(initialIds, 'sse')))
  vi.stubGlobal('fetch', fetchMock)
  client = createLeadInboxClient({
    userId: 'rep-1',
    onStateChange: (state) => states.push(state),
  })
  await vi.advanceTimersByTimeAsync(0)
  return { states, fetchMock }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'Date',
      'performance',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  })
  vi.setSystemTime(new Date('2026-11-19T01:00:00Z'))
  localStorage.clear()
  banners.length = 0
  Stream.count = 0
  vi.stubGlobal('EventSource', Stream)
  vi.stubGlobal('BroadcastChannel', Channel)
  vi.stubGlobal('Notification', Banner)
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

it('preserves a healthy SSE stream on focus without flashing disconnected', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json(snapshot(['old'], 'sse')))
  const { states } = await startSseClient(['old'], fetchMock)
  const initialStream = Stream.current
  initialStream.send(frame(0, ['old']))
  states.length = 0

  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)

  expect(states.some((s) => s.connection === 'disconnected')).toBe(false)
  expect(initialStream.closed).toBe(false)
  expect(Stream.count).toBe(1)

  await vi.advanceTimersByTimeAsync(10_000)
  initialStream.send(frame(1, ['old', 'fresh']))
  await Promise.resolve()
  expect(banners).toEqual(['Company fresh'])
})

it('revalidates on focus and discards in-flight frames when the session expired', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 401 }))
  const { states } = await startSseClient(['old'], fetchMock)
  const previous = Stream.current
  previous.send(frame(0, ['old']))

  window.dispatchEvent(new Event('focus'))
  previous.send(frame(1, ['old', 'must-not-alert']))
  await vi.advanceTimersByTimeAsync(0)

  expect(states.at(-1)?.connection).toBe('signed-out')
  expect(states.at(-1)?.notifications).toEqual([])
  expect(banners).toEqual([])
})

it('retains the inbox and silently rebaselines after malformed stream data', async () => {
  const { states } = await startSseClient(['old'])
  Stream.current.send(frame(0, ['old']))
  expect(() => Stream.current.send('{broken')).not.toThrow()
  expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['old'])
  expect(states.at(-1)?.connection).toBe('disconnected')
  await vi.advanceTimersByTimeAsync(1000)
  Stream.current.send(frame(0, ['old', 'recovered'], 'connection-2'))
  expect(banners).toEqual([])
  await vi.advanceTimersByTimeAsync(10_000)
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
    await startSseClient([])
    Stream.current.send(frame(0))
    await vi.advanceTimersByTimeAsync(10_000)
    Stream.current.send(frame(1, ['queued']))
    if (reason === 'removed') {
      await vi.advanceTimersByTimeAsync(10_000)
      Stream.current.send(frame(2))
    } else if (reason === 'clock jump') {
      vi.setSystemTime(new Date('2026-11-19T00:55:00Z'))
    } else {
      client?.dispose()
    }
    pending.forEach((run) => run())
    expect(banners).toEqual([])
    expect(localStorage.getItem('lead-alerts:rep-1:shown')).toBeNull()
  },
)

it.each(['error', 'silent stream'] as const)(
  'silently refreshes cards when the stream has %s',
  async (failure) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(snapshot(['fallback'], 'sse')))
    const { states } = await startSseClient(['old'], fetchMock)
    Stream.current.send(frame(0, ['old']))
    if (failure === 'error') Stream.current.onerror?.()
    await vi.advanceTimersByTimeAsync(30_001)
    expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['fallback'])
    expect(banners).toEqual([])
    client?.dispose()
    const count = states.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(states.length).toBe(count)
  },
)

it('clears recipient data and stops delivery after authentication expires', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 401 }))
  const { states } = await startSseClient(['old'], fetchMock)
  Stream.current.send(frame(0, ['old']))
  const previous = Stream.current
  previous.onerror?.()
  await vi.advanceTimersByTimeAsync(1000)
  expect(states.at(-1)?.connection).toBe('signed-out')
  expect(states.at(-1)?.notifications).toEqual([])
  previous.send(frame(1, ['other']))
  window.dispatchEvent(new Event('focus'))
  expect(states.at(-1)?.connection).toBe('signed-out')
  expect(banners).toEqual([])
})

it('discards buffered frames from an interrupted connection and rebaselines silently', async () => {
  await startSseClient(['old'])
  const interrupted = Stream.current
  interrupted.send(frame(0, ['old']))
  await vi.advanceTimersByTimeAsync(31_000)
  interrupted.send(frame(1, ['buffered']))
  interrupted.send(frame(2, ['buffered', 'also-buffered']))
  Stream.current.send(frame(0, ['buffered', 'also-buffered'], 'connection-2'))
  expect(banners).toEqual([])
  await vi.advanceTimersByTimeAsync(10_000)
  Stream.current.send(
    frame(1, ['buffered', 'also-buffered', 'fresh'], 'connection-2'),
  )
  expect(banners).toEqual(['Company fresh'])
})

it.each(['timestamp', 'duplicates', 'unsafe URL'] as const)(
  'rejects malformed %s without replacing cards',
  async (problem) => {
    const { states } = await startSseClient(['old'])
    Stream.current.send(frame(0, ['old']))
    const invalid = frame(1, ['bad'])
    if (problem === 'timestamp') invalid.serverTime = 'not-a-date'
    if (problem === 'duplicates') invalid.notifications.push(item('bad'))
    if (problem === 'unsafe URL')
      invalid.notifications[0].leadUrl = 'javascript:alert(1)'
    expect(() => Stream.current.send(invalid)).not.toThrow()
    expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['old'])
    expect(banners).toEqual([])
  },
)

it('propagates acknowledged Clear across tabs and cancels queued banners', async () => {
  const pending: (() => void)[] = []
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: async (_name: string, run: () => void) => {
        pending.push(run)
      },
    },
  })
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/clear'))
      return Promise.resolve(Response.json({ success: true }))
    return Promise.resolve(Response.json(snapshot([], 'sse')))
  })
  vi.stubGlobal('fetch', fetchMock)
  const statesA: LeadInboxState[] = []
  const statesB: LeadInboxState[] = []
  client = createLeadInboxClient({
    userId: 'rep-1',
    onStateChange: (s) => statesA.push(s),
  })
  await vi.advanceTimersByTimeAsync(0)
  const streamA = Stream.current
  streamA.send(frame(0))
  peer = createLeadInboxClient({
    userId: 'rep-1',
    onStateChange: (s) => statesB.push(s),
  })
  await vi.advanceTimersByTimeAsync(0)
  const streamB = Stream.current
  streamB.send(frame(0))

  await vi.advanceTimersByTimeAsync(10_000)
  streamA.send(frame(1, ['clear-me']))
  streamB.send(frame(1, ['clear-me']))

  expect(await client.clear('clear-me')).toBe(true)
  pending.forEach((run) => run())
  expect(banners).toEqual([])
  // An already in-flight snapshot cannot resurrect the acknowledged card.
  streamB.send(frame(2, ['clear-me']))
  expect(statesB.at(-1)?.notifications).toEqual([])
})

it('rejects a future-dated live frame rather than extending its alert lifetime', async () => {
  const { states } = await startSseClient(['old'])
  Stream.current.send(frame(0, ['old']))
  await vi.advanceTimersByTimeAsync(10_000)
  Stream.current.send({
    ...frame(1, ['future']),
    serverTime: '2026-11-19T01:01:00Z',
  })
  expect(banners).toEqual([])
  expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['old'])
})

it('ignores a late fallback response after a new live baseline', async () => {
  let finish!: (value: Response) => void
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  const { states } = await startSseClient(['old'], fetchMock)
  Stream.current.send(frame(0, ['old']))
  Stream.current.onerror?.()
  await vi.advanceTimersByTimeAsync(1000)
  Stream.current.send(frame(0, ['new'], 'connection-2'))
  finish(Response.json(snapshot(['stale'], 'sse')))
  await vi.advanceTimersByTimeAsync(0)
  expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['new'])
  expect(banners).toEqual([])
})

it('stops reconnecting and hands off silently when SSE eligibility is withdrawn', async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(Response.json(snapshot(['recovered'], 'polling'))),
    )
  const { states } = await startSseClient(['old'], fetchMock)
  const previous = Stream.current
  previous.send(frame(0, ['old']))
  previous.onerror?.()
  await vi.advanceTimersByTimeAsync(60_000)
  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)
  expect(Stream.count).toBe(1)
  expect(Stream.current).toBe(previous)
  expect(banners).toEqual([])
  expect(states.at(-1)?.connection).toBe('connected')
  expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['recovered'])
})

it('keeps arrivals in a rotation gap silent but alerts on subsequent live arrivals', async () => {
  await startSseClient([])
  const previous = Stream.current
  previous.send(frame(0))
  previous.dispatchEvent(new Event('rotate'))
  previous.send(frame(1, ['gap']))
  Stream.current.send(frame(0, ['gap'], 'connection-2'))
  expect(banners).toEqual([])
  await vi.advanceTimersByTimeAsync(10_000)
  Stream.current.send(frame(1, ['gap', 'fresh'], 'connection-2'))
  expect(banners).toEqual(['Company fresh'])
})

it('alerts on contiguous polling arrivals while keeping initial backlog silent', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(snapshot(['backlog'], 'polling')))
    .mockResolvedValueOnce(
      Response.json(snapshot(['backlog', 'live-poll'], 'polling')),
    )
  vi.stubGlobal('fetch', fetchMock)
  const states: LeadInboxState[] = []
  client = createLeadInboxClient({
    userId: 'rep-1',
    onStateChange: (s) => states.push(s),
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(banners).toEqual([])
  expect(states.at(-1)?.notifications.map((n) => n.id)).toEqual(['backlog'])
  await vi.advanceTimersByTimeAsync(15_000)
  expect(banners).toEqual(['Company live-poll'])
})
