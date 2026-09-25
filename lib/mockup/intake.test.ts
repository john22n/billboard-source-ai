import { describe, expect, it } from 'vitest'
import {
  freshIntake,
  importLead,
  nextQuestion,
  applyAnswers,
  restart,
  includeWebsiteCopy,
  summarySchema,
} from './intake'

describe('mockup intake', () => {
  it('imports facts without treating a contact phone as required billboard copy', () => {
    const intake = importLead({
      entityName: 'Alpine Dental',
      phone: '303-555-0123',
      targetCity: 'Boulder',
      billboardPurpose: 'Calls',
    })
    expect(intake.advertiser).toBe('Alpine Dental')
    expect(intake.market).toBe('Boulder')
    expect(intake.required).toBeNull()
    expect(nextQuestion(intake)).toBe('website')
  })
  it('retains multiple answers and skips answered or explicitly skipped questions', () => {
    const intake = applyAnswers(freshIntake(), {
      advertiser: 'Mesa',
      website: '',
      goal: 'Visits',
      tone: 'Fun',
    })
    expect(nextQuestion(intake)).toBe('market')
    expect(applyAnswers(intake, { market: 'Denver' }).tone).toBe('Fun')
  })
  it('restart discards the selected image and all prior creative direction', () => {
    const state = restart()
    expect(state.intake).toEqual(freshIntake())
    expect(state.image).toBeNull()
    expect(state.messages).toEqual([])
    expect(nextQuestion(state.intake)).toBe('advertiser')
  })

  it('adds a supplied website to proposed copy without dropping other required contact details', () => {
    const summary = {
      headline: 'Alpine',
      supporting: 'Open Sunday',
      contact: '555-0123',
      direction: 'Bold',
      caution: '',
    }
    expect(
      includeWebsiteCopy(summary, 'https://alpine.example/book/', false),
    ).toEqual({
      ...summary,
      contact: '555-0123 · alpine.example/book',
    })
    expect(includeWebsiteCopy(summary, 'alpine.example', true)).toEqual(summary)
    expect(includeWebsiteCopy(summary, '', false)).toEqual(summary)
    const alreadyIncluded = { ...summary, supporting: 'Book at alpine.example' }
    expect(
      includeWebsiteCopy(alreadyIncluded, 'https://alpine.example/', false),
    ).toEqual(alreadyIncluded)
  })

  it('warns rather than truncating required copy when the website would exceed the contact limit', () => {
    const summary = {
      headline: 'Alpine',
      supporting: '',
      contact: 'x'.repeat(500),
      direction: 'Bold',
      caution: 'c'.repeat(600),
    }
    const result = includeWebsiteCopy(summary, 'alpine.example', false)
    expect(result.contact).toBe(summary.contact)
    expect(result.caution).toContain('Add a shorter website address')
    expect(summarySchema.safeParse(result).success).toBe(true)
  })
})
