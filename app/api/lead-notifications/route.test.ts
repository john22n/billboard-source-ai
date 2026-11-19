import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  list: vi.fn(),
  clear: vi.fn(),
}))
vi.mock('@/lib/dal', () => ({ getCurrentUser: mocks.currentUser }))
vi.mock('@/lib/lead-notifications/store', () => ({
  listNotifications: mocks.list,
  clearNotification: mocks.clear,
}))
import { GET } from './route'
import { POST } from './[id]/clear/route'
const request = () =>
  new Request('http://localhost/api/lead-notifications?leadSsePrototype=true')
afterEach(() => vi.unstubAllEnvs())

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NUTSHELL_NOTIFICATIONS_ENABLED', 'true')
  mocks.currentUser.mockResolvedValue({
    id: 'rep-a',
    email: 'sky@billboardsource.com',
  })
  mocks.list.mockResolvedValue([
    {
      id: '101-leads',
      companyName: 'Company',
      leadUrl: 'https://app.nutshell.com/leads/101',
      leadCreatedAt: new Date('2026-11-09T00:00:00Z'),
      createdAt: new Date('2026-11-09T00:00:01Z'),
    },
  ])
})

it('exposes only the session recipient contract', async () => {
  const response = await GET(request())
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(await response.json()).toMatchObject({
    userId: 'rep-a',
    notifications: [
      { id: '101-leads', leadCreatedAt: '2026-11-09T00:00:00.000Z' },
    ],
    serverTime: expect.any(String),
  })
  expect(mocks.list).toHaveBeenCalledWith('rep-a')
})
it('rejects signed out reads and clears', async () => {
  mocks.currentUser.mockResolvedValue(null)
  expect((await GET(request())).status).toBe(401)
  expect(
    (
      await POST(new Request('http://localhost'), {
        params: Promise.resolve({ id: '101-leads' }),
      })
    ).status,
  ).toBe(401)
  expect(mocks.clear).not.toHaveBeenCalled()
})
it('returns empty when disabled without reading notifications', async () => {
  vi.stubEnv('NUTSHELL_NOTIFICATIONS_ENABLED', 'false')
  expect(await (await GET(request())).json()).toMatchObject({
    notifications: [],
    userId: 'rep-a',
  })
  expect(mocks.list).not.toHaveBeenCalled()
})
it('advertises SSE only to an allowed preview session, regardless of URL opt-in', async () => {
  vi.stubEnv('LEAD_NOTIFICATIONS_SSE_ENABLED', 'true')
  vi.stubEnv(
    'LEAD_NOTIFICATIONS_RECIPIENT_ALLOWLIST',
    'sky@billboardsource.com',
  )
  vi.stubEnv('VERCEL_ENV', 'production')
  expect(await (await GET(request())).json()).toMatchObject({
    transport: 'polling',
  })
  vi.stubEnv('VERCEL_ENV', 'preview')
  expect(
    await (
      await GET(new Request('http://localhost/api/lead-notifications'))
    ).json(),
  ).toMatchObject({ transport: 'sse' })
  mocks.currentUser.mockResolvedValue({
    id: 'rep-b',
    email: 'other@example.test',
  })
  expect(await (await GET(request())).json()).toMatchObject({
    transport: 'polling',
  })
})
it('scopes clear to the session and returns 404 for another or missing notice', async () => {
  mocks.clear.mockResolvedValue(false)
  const context = { params: Promise.resolve({ id: '101-leads' }) }
  expect(
    (
      await POST(
        new Request('http://localhost?userId=rep-b', { method: 'POST' }),
        context,
      )
    ).status,
  ).toBe(404)
  expect(mocks.clear).toHaveBeenCalledWith('101-leads', 'rep-a')
  mocks.clear.mockResolvedValue(true)
  expect((await POST(new Request('http://localhost'), context)).status).toBe(
    200,
  )
})
