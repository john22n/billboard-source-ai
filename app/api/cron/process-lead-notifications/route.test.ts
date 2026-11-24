import { beforeEach, expect, it, vi } from 'vitest'
const process = vi.hoisted(() => vi.fn())
vi.mock('@/lib/lead-notifications/processor', () => ({
  processLeadNotifications: process,
}))
import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'cron-secret')
})
it('authenticates scheduled retries before invoking the processor', async () => {
  expect((await GET(new Request('http://localhost'))).status).toBe(401)
  expect(process).not.toHaveBeenCalled()
  process.mockResolvedValue({ enabled: false, processed: 0 })
  expect(
    (
      await GET(
        new Request('http://localhost', {
          headers: { Authorization: 'Bearer cron-secret' },
        }),
      )
    ).status,
  ).toBe(200)
  expect(process).toHaveBeenCalledOnce()
})
it('fails closed with no configured scheduler secret', async () => {
  vi.stubEnv('CRON_SECRET', '')
  expect(
    (
      await GET(
        new Request('http://localhost', {
          headers: { Authorization: 'Bearer ' },
        }),
      )
    ).status,
  ).toBe(503)
  expect(process).not.toHaveBeenCalled()
})
