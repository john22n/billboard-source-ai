import { decodeJwt } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}))
vi.mock('@/db', () => ({ db: {} }))
vi.mock('@/db/schema', () => ({ user: {} }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    auth: {
      jwtSecret: 'test-secret-at-least-thirty-two-characters',
      secureCookies: false,
    },
  },
}))

import { endCallSessionProtection } from './auth'

describe('endCallSessionProtection', () => {
  it('restores the original ten-hour cutoff and removes the active call', async () => {
    const sessionStartedAt = 1_700_000_000

    await expect(
      endCallSessionProtection({
        userId: 'user-1',
        email: 'rep@example.com',
        role: 'user',
        sessionStartedAt,
      }),
    ).resolves.toBe(true)

    const token = cookieSet.mock.calls[0][0].value as string
    const payload = decodeJwt(token)

    expect(payload.exp).toBe(sessionStartedAt + 10 * 60 * 60)
    expect(payload.sessionStartedAt).toBe(sessionStartedAt)
    expect(payload.activeCallSid).toBeUndefined()
  })
})
