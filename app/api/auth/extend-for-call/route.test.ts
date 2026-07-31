import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callFetch, extendSessionForCall, getSession } = vi.hoisted(() => ({
  callFetch: vi.fn(),
  extendSessionForCall: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ extendSessionForCall, getSession }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'AC-account',
        authToken: 'auth-token',
      }),
    },
  },
}))
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ calls: vi.fn(() => ({ fetch: callFetch })) })),
}))

import { POST } from './route'

const callSid = `CA${'a'.repeat(32)}`
const request = () =>
  new NextRequest('https://example.com/api/auth/extend-for-call', {
    method: 'POST',
    body: JSON.stringify({ callSid }),
  })

describe('POST /api/auth/extend-for-call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({
      userId: 'user-1',
      email: 'rep@example.com',
      role: 'user',
      issuedAt: 100,
      sessionStartedAt: 100,
    })
    callFetch.mockResolvedValue({
      status: 'in-progress',
      to: 'client:rep@example.com',
    })
    extendSessionForCall.mockResolvedValue(true)
  })

  it('renews an authenticated session when a call is accepted', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(extendSessionForCall).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      callSid,
    )
  })

  it('rejects a request without an active session', async () => {
    getSession.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(extendSessionForCall).not.toHaveBeenCalled()
  })

  it('rejects a call that does not belong to the signed-in rep', async () => {
    callFetch.mockResolvedValue({
      status: 'in-progress',
      to: 'client:someone-else@example.com',
    })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(extendSessionForCall).not.toHaveBeenCalled()
  })
})
