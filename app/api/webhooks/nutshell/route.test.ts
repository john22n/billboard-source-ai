import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ after: vi.fn(), returning: vi.fn() }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/db', () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: mocks.returning }),
      }),
    }),
  },
}))
import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NUTSHELL_WEBHOOK_SECRET', 'a'.repeat(32))
  vi.stubEnv('NUTSHELL_NOTIFICATIONS_ENABLED', 'true')
  vi.stubEnv('LEAD_NOTIFICATIONS_LAUNCH_CUTOFF', '2026-11-09T00:00:00Z')
  vi.stubEnv('NUTSHELL_API_KEY', 'synthetic')
  vi.stubEnv('LEAD_NOTIFICATIONS_RECIPIENT_ALLOWLIST', 'rep@example.test')
  mocks.returning.mockResolvedValue([{ id: 1 }])
})
const request = () =>
  new Request(
    `http://localhost/api/webhooks/nutshell?token=${'a'.repeat(32)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            id: '1-events',
            payloadType: 'leads',
            action: 'create',
            links: { payloads: ['101-leads'] },
          },
        ],
      }),
    },
  )
it('schedules processing only after durable intake and when enabled', async () => {
  expect((await POST(request())).status).toBe(202)
  expect(mocks.after).toHaveBeenCalledOnce()
  vi.stubEnv('LEAD_NOTIFICATIONS_LAUNCH_CUTOFF', '')
  mocks.after.mockClear()
  expect((await POST(request())).status).toBe(202)
  expect(mocks.after).not.toHaveBeenCalled()
})
it('does not schedule failed intake', async () => {
  mocks.returning.mockRejectedValue(new Error('unavailable'))
  expect((await POST(request())).status).toBe(503)
  expect(mocks.after).not.toHaveBeenCalled()
})
