import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicAddress, fetchPublicWebsite, reviewWebsite } from './website'

const fixtures = vi.hoisted(
  () => new Map<string, { type: string; body: string; location?: string }>(),
)
const requested = vi.hoisted(() => [] as string[])
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.215.14', family: 4 }],
}))
vi.mock('node:https', () => ({
  request: (
    url: URL,
    _options: unknown,
    callback: (response: EventEmitter) => void,
  ) => {
    requested.push(url.href)
    const fixture = fixtures.get(url.href)
    const req = Object.assign(new EventEmitter(), {
      end() {
        const res = Object.assign(new EventEmitter(), {
          statusCode: fixture?.location ? 302 : fixture ? 200 : 404,
          headers: {
            'content-type': fixture?.type,
            location: fixture?.location,
          },
        })
        callback(res)
        queueMicrotask(() => {
          res.emit('data', Buffer.from(fixture?.body || ''))
          res.emit('end')
        })
      },
      destroy(error: Error) {
        req.emit('error', error)
      },
    })
    return req
  },
}))

beforeEach(() => {
  fixtures.clear()
  requested.length = 0
})

it('reviews colors from linked CSS, inline styles, and theme metadata', async () => {
  fixtures.set('https://example.com/', {
    type: 'text/html',
    body: `<title>Example AI</title><meta name="theme-color" content="#14283f">
      <link rel="stylesheet" href="/assets/brand.css">
      <body><h1 style="color: #f9e7c4">AI Integration</h1></body>`,
  })
  fixtures.set('https://example.com/assets/brand.css', {
    type: 'text/css',
    body: ':root { --brand-primary: #14283f; --brand-accent: #ed7b32; } .cta { background-color: var(--brand-accent); }',
  })
  const result = await reviewWebsite('https://example.com')
  expect(result.text).toContain('#14283f')
  expect(result.text).toContain('--brand-accent: #ed7b32')
  expect(result.text).toContain('#f9e7c4')
  expect(result.text).toContain('AI Integration')
})

it('bounds stylesheet requests and keeps useful evidence when CSS is unavailable', async () => {
  fixtures.set('https://example.com/', {
    type: 'text/html',
    body: `<style>:root { --brand-primary: #123456 }</style>
      ${Array.from({ length: 6 }, (_, i) => `<link rel="stylesheet" href="/style-${i}.css">`).join('')}
      <link rel="stylesheet" href="http://127.0.0.1/private.css">
      <body>Useful advertiser facts</body>`,
  })
  const result = await reviewWebsite('https://example.com')
  expect(result.text).toContain('#123456')
  expect(result.text).toContain('Useful advertiser facts')
  expect(requested).toHaveLength(4)
  expect(requested.some((url) => url.includes('127.0.0.1'))).toBe(false)
})

describe('website isolation', () => {
  it('blocks local, metadata, multicast and IPv4-mapped private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(publicAddress(address)).toBe(false)
    expect(publicAddress('8.8.8.8')).toBe(true)
    expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('rejects non-HTTPS schemes and credentials before making a request', async () => {
    await expect(fetchPublicWebsite('http://example.com')).rejects.toThrow(
      'HTTPS',
    )
    await expect(
      fetchPublicWebsite('https://user:secret@example.com'),
    ).rejects.toThrow('HTTPS')
    expect(await reviewWebsite('')).toMatchObject({
      logo: null,
      fallback: expect.stringContaining('name will appear as text'),
    })
  })
})
