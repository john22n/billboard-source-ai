import { z } from 'zod'

export const questions = {
  advertiser: 'What is the advertiser’s name?',
  website: 'What is their website? You can say skip.',
  goal: 'What should this billboard accomplish: awareness, calls, visits, an event, political, hiring, an opening, or an offer?',
  market: 'Which city, market, or audience should it reach?',
  focus: 'What product, service, event, or message should it focus on?',
  required:
    'What exact text must appear? Include any phone, website, slogan, date, address, candidate name, or legal disclaimer—or say skip.',
  tone: 'What tone feels right: professional, bold, premium, fun, urgent, community, political, minimal, or family-friendly? Unsure is fine.',
} as const

const answer = z.string().max(2000).nullable()
export const intakeSchema = z.object({
  advertiser: answer,
  website: answer,
  goal: answer,
  market: answer,
  focus: answer,
  required: answer,
  tone: answer,
  boardType: z.string().max(100).default('Static'),
})
export type Intake = z.infer<typeof intakeSchema>
export type Question = keyof typeof questions
export const summarySchema = z.object({
  headline: z.string().max(200),
  supporting: z.string().max(2000),
  contact: z.string().max(500),
  direction: z.string().max(1000),
  caution: z.string().max(600),
})
export type Summary = z.infer<typeof summarySchema>

/** The supplied website is proposed copy; approval edits remain authoritative. */
export function includeWebsiteCopy(
  summary: Summary,
  website: string | null,
  omitWebsite: boolean,
): Summary {
  const address = (website || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
  if (!address || omitWebsite) return summary
  const copy =
    `${summary.headline} ${summary.supporting} ${summary.contact}`.toLowerCase()
  if (copy.includes(address.toLowerCase())) return summary
  const contact = [summary.contact, address].filter(Boolean).join(' · ')
  if (contact.length > 500)
    return {
      ...summary,
      caution:
        `The website and contact details exceed the copy limit. Add a shorter website address in the contact field before generating. ${summary.caution}`
          .trim()
          .slice(0, 600),
    }
  return { ...summary, contact }
}

export type Brand = {
  notes: string
  fallback: string
  logo: string | null
  receipt: string | null
}
export const imageSchema = z.object({
  id: z.string().uuid(),
  advertiser: z.string().max(2000),
  dataUrl: z.string().max(2_800_000).startsWith('data:image/jpeg;base64,'),
  receipt: z.string().max(6000),
})
export type MockupImage = z.infer<typeof imageSchema>
export type LeadTarget = { id: number; name: string; advertiser: string }
export type MockupState = {
  started: boolean
  intake: Intake
  messages: { role: 'user' | 'assistant'; text: string }[]
  summary: Summary | null
  brand: Brand | null
  image: MockupImage | null
  lastLead: LeadTarget | null
  attachmentFailed: boolean
}

export function freshIntake(): Intake {
  return {
    advertiser: null,
    website: null,
    goal: null,
    market: null,
    focus: null,
    required: null,
    tone: null,
    boardType: 'Static',
  }
}
export function restart(): MockupState {
  return {
    started: true,
    intake: freshIntake(),
    messages: [],
    summary: null,
    brand: null,
    image: null,
    lastLead: null,
    attachmentFailed: false,
  }
}
export function nextQuestion(intake: Intake): Question | undefined {
  return (Object.keys(questions) as Question[]).find(
    (key) => intake[key] === null,
  )
}
export function applyAnswers(intake: Intake, answers: Partial<Intake>): Intake {
  return {
    ...intake,
    ...Object.fromEntries(
      Object.entries(answers).filter(
        ([, value]) => value !== null && value !== undefined,
      ),
    ),
  }
}

/** Only direct facts: a caller's phone is not automatically billboard copy. */
export function importLead(lead: Record<string, unknown>): Intake {
  const value = (key: string) =>
    typeof lead[key] === 'string' && lead[key].trim() ? lead[key].trim() : null
  return {
    ...freshIntake(),
    advertiser: value('entityName'),
    website: value('website'),
    goal: value('billboardPurpose'),
    focus: value('accomplishDetails'),
    market:
      ['targetCity', 'state', 'targetArea', 'targetAudience']
        .map(value)
        .filter(Boolean)
        .join(', ') || null,
    boardType: value('boardType') || 'Static',
  }
}

export function sameAdvertiser(a: string, b: string) {
  const normalize = (s: string) =>
    s.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return !!normalize(a) && normalize(a) === normalize(b)
}
