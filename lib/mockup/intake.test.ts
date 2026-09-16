import { describe, expect, it } from 'vitest'
import {
  freshIntake,
  importLead,
  nextQuestion,
  applyAnswers,
  restart,
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
})
