import { describe, expect, it } from 'vitest'
import { denverDay } from './quota'

describe('Denver image request day', () => {
  it('resets at local midnight, including both DST offsets', () => {
    expect(denverDay(new Date('2026-07-02T05:59:59Z'))).toBe('2026-07-01')
    expect(denverDay(new Date('2026-07-02T06:00:00Z'))).toBe('2026-07-02')
    expect(denverDay(new Date('2026-01-02T06:59:59Z'))).toBe('2026-01-01')
    expect(denverDay(new Date('2026-01-02T07:00:00Z'))).toBe('2026-01-02')
  })
})
