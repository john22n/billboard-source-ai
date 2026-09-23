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
    const response = await GET()
    expect(response.status).toBe(status)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('returns the complete server-filtered history without a cursor', async () => {
    mocks.getSession.mockResolvedValue({ userId: 'u', role: 'admin' })
    mocks.list.mockResolvedValue({
      calls: [],
      since: '',
      until: '',
      warnings: [],
    })
    const response = await GET()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      calls: [],
      since: '',
      until: '',
      warnings: [],
    })
    expect(mocks.list).toHaveBeenCalledWith({
      accountSid: 'AC',
      authToken: 'token',
    })
  })
})
