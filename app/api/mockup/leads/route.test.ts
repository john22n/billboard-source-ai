import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'rep', email: 'rep@example.test' })),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { nutshell: { requireApiKey: () => 'test-only' } },
}))
vi.mock('@/lib/mockup/receipts', () => ({ verifyImage: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => {
    throw new Error('Database unavailable')
  }),
}))

import { GET, POST } from './route'
import { getSession } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('returns deduplicated Nutshell candidates without database rate limiting', async () => {
  const lead = {
    id: 42,
    name: 'Spring',
    primaryAccountName: 'Green Oasis',
    creator: { emails: ['rep@example.test'] },
  }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ result: { leads: [lead], accounts: [{ id: 15 }] } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        result: [
          lead,
          { ...lead, id: 73, name: 'Summer' },
          { ...lead, id: 99, creator: { emails: ['other@example.test'] } },
        ],
      }),
    )
  vi.stubGlobal('fetch', fetcher)

  const response = await GET(
    new Request('http://localhost/api/mockup/leads?q=Green%20Oasis'),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    leads: [
      { id: 42, name: 'Spring', advertiser: 'Green Oasis' },
      { id: 73, name: 'Summer', advertiser: 'Green Oasis' },
    ],
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(rateLimit).not.toHaveBeenCalled()
})

it('attaches only to the confirmed selected lead without database rate limiting', async () => {
  const image = {
    id: '12345678-1234-4123-8123-123456789abc',
    advertiser: 'Green Oasis',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    receipt: 'signed',
  }
  const lead = {
    id: 73,
    rev: '1',
    name: 'Summer',
    primaryAccountName: 'Green Oasis',
  }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ result: lead }))
    .mockResolvedValueOnce(
      Response.json({
        result: {
          ...lead,
          file: [
            {
              name: `billboard-concept-${image.id}.jpg`,
              uri: 'https://app.nutshell.com/file/api/9',
            },
          ],
        },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const request = (confirmedLeadId: number) =>
    new Request('http://localhost/api/mockup/leads', {
      method: 'POST',
      body: JSON.stringify({ leadId: 73, confirmedLeadId, image }),
    })
  expect((await POST(request(42))).status).toBe(400)
  expect(fetcher).not.toHaveBeenCalled()
  const response = await POST(request(73))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    success: true,
    target: {
      id: 73,
      name: 'Summer',
      advertiser: 'Green Oasis',
    },
  })
  expect(
    fetcher.mock.calls.slice(0, 2).map((call) => JSON.parse(call[1].body)),
  ).toMatchObject([
    { method: 'getLead', params: { leadId: 73 } },
    { method: 'editLead', params: { leadId: 73 } },
  ])
  expect(rateLimit).not.toHaveBeenCalled()
})

it('still requires authentication before searching Nutshell', async () => {
  vi.mocked(getSession).mockResolvedValueOnce(null)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(
    (await GET(new Request('http://localhost/api/mockup/leads?q=Green')))
      .status,
  ).toBe(401)
  expect(fetcher).not.toHaveBeenCalled()
})
