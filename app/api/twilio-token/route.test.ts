import { beforeEach, describe, expect, it, vi } from 'vitest'

const { accessTokenConstructor, cookieGet, getSession } = vi.hoisted(() => ({
  accessTokenConstructor: vi.fn(),
  cookieGet: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}))

vi.mock('@/lib/auth', () => ({
  getSession,
  TWILIO_TOKEN_SESSION_COOKIE: 'twilio_token_session',
}))

vi.mock('@/lib/config', () => ({
  configErrorResponseBody: vi.fn(),
  isMissingConfig: vi.fn(() => false),
  serverConfig: {
    auth: { secureCookies: true },
    twilio: {
      requireVoiceCredentials: () => ({
        accountSid: 'AC-account',
        apiKeySid: 'SK-key',
        apiKeySecret: 'secret',
      }),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}))

vi.mock('twilio', () => {
  class VoiceGrant {}
  class AccessToken {
    static VoiceGrant = VoiceGrant

    constructor(...args: unknown[]) {
      accessTokenConstructor(...args)
    }

    addGrant() {}

    toJwt() {
      return 'voice-token'
    }
  }

  return { default: { jwt: { AccessToken } } }
})

import { GET } from './route'

describe('GET /api/twilio-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({
      userId: 'user-1',
      email: 'rep@example.com',
      issuedAt: Math.floor(Date.now() / 1000),
      sessionId: 'login-session-1',
    })
    cookieGet.mockReturnValue({ value: 'login-session-1' })
  })

  it('issues a fresh voice token after the dashboard reloads', async () => {
    const firstResponse = await GET()
    const reloadResponse = await GET()

    expect(firstResponse.status).toBe(200)
    expect(reloadResponse.status).toBe(200)
    expect(reloadResponse.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    )
    await expect(reloadResponse.json()).resolves.toMatchObject({
      token: 'voice-token',
      identity: 'rep@example.com',
      expiresAt: expect.any(Number),
    })
  })

  it('limits the voice token to the remaining login session lifetime', async () => {
    const now = Math.floor(Date.now() / 1000)
    getSession.mockResolvedValue({
      userId: 'user-1',
      email: 'rep@example.com',
      issuedAt: now - 60 * 60,
    })

    await GET()

    const options = accessTokenConstructor.mock.calls[0][3]
    expect(options).toMatchObject({
      identity: 'rep@example.com',
      ttl: expect.any(Number),
    })
    expect(options.ttl).toBeGreaterThanOrEqual(7 * 60 * 60 - 2)
    expect(options.ttl).toBeLessThanOrEqual(7 * 60 * 60)
  })
})
