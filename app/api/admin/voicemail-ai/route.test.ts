import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'AC',
        authToken: 'token',
      }),
    },
  },
}))
vi.mock('@/lib/voicemail-ai-logs', () => ({
  InvalidCursorError: class extends Error {},
  listVoicemailAICalls: mocks.list,
}))

import { GET } from './route'

describe('GET /api/admin/voicemail-ai', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [null, 401],
    [{ userId: 'u', role: 'user' }, 403],
  ])('enforces the admin gate', async (session, status) => {
    mocks.getSession.mockResolvedValue(session)
    const response = await GET(
      new Request('https://app.test/api/admin/voicemail-ai'),
    )
    expect(response.status).toBe(status)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('passes only an opaque cursor to the provider', async () => {
    mocks.getSession.mockResolvedValue({ userId: 'u', role: 'admin' })
    mocks.list.mockResolvedValue({
      calls: [],
      nextCursor: null,
      since: '',
      until: '',
      warnings: [],
    })
    await GET(
      new Request('https://app.test/api/admin/voicemail-ai?cursor=opaque'),
    )
    expect(mocks.list).toHaveBeenCalledWith(
      { accountSid: 'AC', authToken: 'token' },
      'opaque',
    )
  })
})
