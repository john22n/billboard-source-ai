import { describe, expect, it } from 'vitest'
import { normalizeCellPhone } from './cell-phone'

describe('cell phone validation', () => {
  it.each([
    [' (303) 555-0123 ', '+13035550123'],
    ['+44 7911 123456', '+447911123456'],
    ['+13035550123', '+13035550123'],
    ['  ', null],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCellPhone(input)).toBe(expected)
  })

  it.each([
    '123',
    '+1234567890123456',
    'call +13035550123',
    '+13035550123 ext 42',
    '+10005550123',
  ])('rejects %s', (input) => {
    expect(() => normalizeCellPhone(input)).toThrow(
      'Enter a valid phone number',
    )
  })
})
