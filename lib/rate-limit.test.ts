import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  privacySafeAccountIdentity,
  privacySafeSourceIdentity,
} from './rate-limit-core'

describe('privacy-safe rate limit identities', () => {
  it('normalizes email and produces a bounded opaque hash', () => {
    const first = privacySafeAccountIdentity(' User@Example.COM ')!
    expect(first).toBe(privacySafeAccountIdentity('user@example.com'))
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(first).not.toContain('user@example.com')
  })

  it('keeps source and account identities independent', () => {
    expect(privacySafeSourceIdentity('203.0.113.1')).not.toBe(
      privacySafeAccountIdentity('203.0.113.1'),
    )
  })

  it('normalizes non-string email to empty', () => {
    expect(normalizeEmail(undefined)).toBe('')
    expect(privacySafeAccountIdentity(undefined)).toBeNull()
  })
})
