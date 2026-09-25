import { z } from 'zod'
import type { CreativeAttachment } from './attachments'

export const MAX_MESSAGES = 80
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(4000),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

/** Website evidence captured by the wizard's review_website tool. */
export const brandSchema = z.object({
  website: z.string().max(2000),
  logo: z.string().max(410_000).nullable(),
  receipt: z.string().max(6000).nullable(),
})
export type Brand = z.infer<typeof brandSchema>

export const imageSchema = z.object({
  id: z.string().uuid(),
  advertiser: z.string().max(2000),
  dataUrl: z.string().max(2_800_000).startsWith('data:image/jpeg;base64,'),
  receipt: z.string().max(6000),
})
export type MockupImage = z.infer<typeof imageSchema>
export type LeadTarget = { id: number; name: string; advertiser: string }
export type MockupState = {
  messages: ChatMessage[]
  attachments: CreativeAttachment[]
  brand: Brand | null
  image: MockupImage | null
  lastLead: LeadTarget | null
  attachmentFailed: boolean
}

export function restart(): MockupState {
  return {
    messages: [],
    attachments: [],
    brand: null,
    image: null,
    lastLead: null,
    attachmentFailed: false,
  }
}

export const START_COMMAND = /^(start|start mockup)[.!]?$/i

/**
 * Opening message for a new mockup. Only direct facts from the lead form are
 * offered; a caller's phone number is not automatically billboard copy.
 */
export function openingMessage(lead: Record<string, unknown> = {}) {
  const value = (key: string) =>
    typeof lead[key] === 'string' && lead[key].trim() ? lead[key].trim() : ''
  const facts = [
    ['Advertiser', value('entityName')],
    ['Website', value('website')],
    ['Goal', value('billboardPurpose')],
    [
      'Market',
      ['targetCity', 'state', 'targetArea', 'targetAudience']
        .map(value)
        .filter(Boolean)
        .join(', '),
    ],
    ['Focus', value('accomplishDetails')],
    ['Board type', value('boardType')],
  ].filter(([, fact]) => fact)
  if (!facts.length) return 'Start'
  return [
    'Start',
    '',
    'Here is what I already know from the lead form:',
    ...facts.map(([label, fact]) => `${label}: ${fact}`),
  ].join('\n')
}

export function sameAdvertiser(a: string, b: string) {
  const normalize = (s: string) =>
    s.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return !!normalize(a) && normalize(a) === normalize(b)
}
