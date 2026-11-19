// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startPrototypeStream } from './prototype-client'

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
  vi.stubGlobal('Notification', Banner)
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: { request: async (_name: string, run: () => void) => run() },
  })
})
afterEach(() => {
  client?.dispose()
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
