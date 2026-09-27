import { describe, expect, it } from 'vitest'
import { leadFormContext, restart, START_COMMAND } from './state'

describe('mockup wizard state', () => {
  it('supplies lead facts but never treats a caller phone as billboard copy', () => {
    const context = leadFormContext({
      entityName: 'Alpine Dental',
      phone: '303-555-0123',
      targetCity: 'Boulder',
      state: 'CO',
      billboardPurpose: 'Calls',
      website: '  ',
    })
    expect(context).toBe(
      'Advertiser: Alpine Dental\nGoal: Calls\nMarket: Boulder, CO',
    )
  })
  it('omits context when the lead form has no creative details', () => {
    expect(leadFormContext()).toBe('')
    expect(leadFormContext({ entityName: '', phone: '303-555-0123' })).toBe('')
  })
  it('bounds context to the API limit without shortening normal creative fields', () => {
    expect(leadFormContext({ accomplishDetails: 'a'.repeat(7993) })).toBe(
      `Focus: ${'a'.repeat(7993)}`,
    )
    expect(leadFormContext({ accomplishDetails: 'a'.repeat(7994) })).toBe(
      `Focus: ${'a'.repeat(7993)}`,
    )
  })
  it('restart discards the selected image and all prior creative direction', () => {
    expect(restart()).toEqual({
      messages: [],
      attachments: [],
      brand: null,
      image: null,
      lastLead: null,
      attachmentFailed: false,
    })
  })
  it.each(['Start', 'start!', 'Start Mockup', 'START MOCKUP.'])(
    'recognizes %s as a reset command',
    (text) => expect(START_COMMAND.test(text)).toBe(true),
  )
  it.each(['Start with the logo', 'restart', 'Started last week'])(
    'sends %s to the wizard as an ordinary message',
    (text) => expect(START_COMMAND.test(text)).toBe(false),
  )
})
