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
  // New designs carry a bulletin and companion poster under one receipt.
  // Older browser sessions retain their original single-image behavior.
  posterDataUrl: z
    .string()
    .max(1_500_000)
    .startsWith('data:image/jpeg;base64,')
    .optional(),
  receipt: z.string().max(6000),
})
export type MockupImage = z.infer<typeof imageSchema>

/** The exact same files are previewed, downloaded, and delivered to Nutshell. */
export function mockupFiles(image: MockupImage) {
  return image.posterDataUrl
    ? [
        {
          label: 'Bulletin',
          dataUrl: image.dataUrl,
          name: `billboard-bulletin-${image.id}.jpg`,
        },
        {
          label: 'Poster',
          dataUrl: image.posterDataUrl,
          name: `billboard-poster-${image.id}.jpg`,
        },
      ]
    : [
        {
          label: 'Selected mockup',
          dataUrl: image.dataUrl,
          name: `billboard-concept-${image.id}.jpg`,
        },
      ]
}

/** Bind both formats together while preserving receipts from older sessions. */
export function imageReceiptData(
  image: Pick<MockupImage, 'dataUrl' | 'posterDataUrl'>,
) {
  return image.posterDataUrl
    ? JSON.stringify([image.dataUrl, image.posterDataUrl])
    : image.dataUrl
}

export type LeadTarget = {
  id: number
  name: string
  advertiser: string
  receipt?: string
}

export const WIZARD_ERROR =
  'The wizard could not respond. Your conversation and selected image are unchanged. Please try again.'
export const MOCKUP_READY =
  'Your mockup is ready. Check every word before sharing, then tell me what you’d like to change.'
export type MockupState = {
  messages: ChatMessage[]
  attachments: CreativeAttachment[]
  brand: Brand | null
  image: MockupImage | null
  /** The receipt-bound original, independent of later design revisions. */
  lastLead: (LeadTarget & { image?: MockupImage }) | null
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
 * Current creative context. Only direct facts from the lead form are
 * offered; a caller's phone number is not automatically billboard copy.
 */
export function leadFormContext(lead: Record<string, unknown> = {}) {
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
  return facts
    .map(([label, fact]) => `${label}: ${fact}`)
    .join('\n')
    .slice(0, 8000)
}

export function sameAdvertiser(a: string, b: string) {
  const normalize = (s: string) =>
    s.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return !!normalize(a) && normalize(a) === normalize(b)
}
