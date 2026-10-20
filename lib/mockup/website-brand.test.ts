import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(
  () => new Map<string, { type: string; body: string }>(),
)
const urls = vi.hoisted(() => [] as string[])
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
}))
vi.mock('node:https', () => ({
  request: (
    url: URL,
    _options: unknown,
    callback: (response: EventEmitter) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void }
    req.end = () =>
      queueMicrotask(() => {
        urls.push(url.href)
        const fixture = fixtures.get(url.href)
        if (!fixture) {
          req.emit('error', new Error('Unavailable fixture'))
          return
        }
        const res = Object.assign(new EventEmitter(), {
          statusCode: 200,
          headers: { 'content-type': fixture.type },
        })
        callback(res)
        res.emit('data', Buffer.from(fixture.body))
        res.emit('end')
      })
    return req
  },
}))
import { reviewWebsite } from './website'

beforeEach(() => {
  fixtures.clear()
  urls.length = 0
})

it.each(['alpine.example', 'http://alpine.example'])(
  'reviews linked same-site stylesheets over HTTPS without fetching third-party CSS (%s)',
  async (website) => {
    fixtures.set('https://alpine.example/', {
      type: 'text/html',
      body: '<title>Alpine</title><link rel="stylesheet" href="https://other.example/tracker.css"><link rel="stylesheet" href="/brand.css"><body>Dental services</body>',
    })
    fixtures.set('https://alpine.example/brand.css', {
      type: 'text/css',
      body: ':root { --brand-primary: #123456; --brand-accent: #fedc98; } h1 { font-family: Georgia, serif; }',
    })
    const result = await reviewWebsite(website)
    expect(result.text).toContain('#123456')
    expect(result.text).toContain('#fedc98')
    expect(result.text).toContain('Georgia')
    expect(urls).toEqual([
      'https://alpine.example/',
      'https://alpine.example/brand.css',
    ])
  },
)

it('preserves website evidence when a stylesheet is unavailable', async () => {
  fixtures.set('https://alpine.example/', {
    type: 'text/html',
    body: '<title>Alpine</title><link rel="stylesheet" href="/unavailable.css"><style>h1 { color: #abcdef; }</style><body>Dental services</body>',
  })
  const result = await reviewWebsite('alpine.example')
  expect(result.text).toContain('Dental services')
  expect(result.text).toContain('#abcdef')
})
