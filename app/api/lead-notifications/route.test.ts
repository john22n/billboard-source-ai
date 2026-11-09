import { beforeEach, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NUTSHELL_NOTIFICATIONS_ENABLED', 'true')
  mocks.currentUser.mockResolvedValue({ id: 'rep-a' })
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
  const response = await GET()
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
  expect((await GET()).status).toBe(401)
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
  expect(await (await GET()).json()).toMatchObject({
    notifications: [],
    userId: 'rep-a',
  })
  expect(mocks.list).not.toHaveBeenCalled()
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
