import { describe, expect, it } from 'vitest'
import { openingMessage, restart, START_COMMAND } from './state'

describe('mockup wizard state', () => {
  it('opens with lead facts but never treats a caller phone as billboard copy', () => {
    const opening = openingMessage({
      entityName: 'Alpine Dental',
      phone: '303-555-0123',
      targetCity: 'Boulder',
      state: 'CO',
      billboardPurpose: 'Calls',
      website: '  ',
    })
    expect(opening.startsWith('Start\n')).toBe(true)
    expect(opening).toContain('Advertiser: Alpine Dental')
    expect(opening).toContain('Market: Boulder, CO')
    expect(opening).toContain('Goal: Calls')
    expect(opening).not.toContain('Website')
    expect(opening).not.toContain('303-555-0123')
  })
  it('opens with a plain Start when the lead form is empty', () => {
    expect(openingMessage()).toBe('Start')
    expect(openingMessage({ entityName: '' })).toBe('Start')
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
