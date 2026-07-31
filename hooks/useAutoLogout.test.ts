import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

import { isAutoLogoutDue } from './useAutoLogout'

describe('isAutoLogoutDue', () => {
  const sessionIssuedAt = Date.UTC(2026, 6, 31, 8, 0, 0) / 1000

  it('keeps the session active until eight and a half hours have elapsed', () => {
    expect(
      isAutoLogoutDue(sessionIssuedAt, new Date('2026-07-31T16:29:59Z')),
    ).toBe(false)
    expect(
      isAutoLogoutDue(sessionIssuedAt, new Date('2026-07-31T16:30:00Z')),
    ).toBe(true)
  })

  it('does not apply the former 7 PM daily cutoff', () => {
    const afternoonSession = Date.UTC(2026, 6, 31, 18, 0, 0) / 1000

    expect(
      isAutoLogoutDue(afternoonSession, new Date('2026-07-31T19:00:00Z')),
    ).toBe(false)
  })
})
