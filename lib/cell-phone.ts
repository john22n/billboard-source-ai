import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

// Blank removes cell ringing. National numbers default to the US; other
// countries must include their +country code. Extensions aren't cell numbers.
export function normalizeCellPhone(value: string): string | null {
  const input = value.trim()
  if (!input) return null
  const phone = parsePhoneNumberFromString(input, {
    defaultCountry: 'US',
    extract: false,
  })
  if (!phone?.isValid() || phone.ext) {
    throw new Error(
      'Enter a valid phone number, including +country code outside the US.',
    )
  }
  return phone.number
}
