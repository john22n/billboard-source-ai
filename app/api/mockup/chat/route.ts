import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import {
  APICallError,
  generateText,
  stepCountIs,
  tool,
  type ModelMessage,
} from 'ai'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { rateLimit } from '@/lib/rate-limit'
import {
  attachmentLabel,
  attachmentsSchema,
  referenceMessages,
} from '@/lib/mockup/attachments'
import {
  billboardImagePrompt,
  toolInstructions,
} from '@/lib/mockup/instructions'
import { renderBillboard } from '@/lib/mockup/render'
import {
  signArtifact,
  verifyArtifact,
  verifyImage,
  type MockupSession,
} from '@/lib/mockup/receipts'
import {
  brandSchema,
  chatMessageSchema,
  imageSchema,
  MAX_MESSAGES,
  type Brand,
  type MockupImage,
} from '@/lib/mockup/state'
import { getSystemPrompt } from '@/lib/mockup/system-prompt'
import { reviewWebsite } from '@/lib/mockup/website'

export const maxDuration = 300
const inputSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(MAX_MESSAGES)
    .refine((messages) => messages.at(-1)?.role === 'user'),
  attachments: attachmentsSchema,
  image: imageSchema.nullable().default(null),
  brand: brandSchema.nullable().default(null),
})
type Input = z.infer<typeof inputSchema>
const headers = { 'Cache-Control': 'no-store' }

/** Artifacts live in the rep's browser tab; every use re-checks their receipts. */
async function verifyArtifacts(session: MockupSession, input: Input) {
  if (input.image) await verifyImage(session, input.image)
  if (input.brand?.logo)
    await verifyArtifact(
      session,
      'logo',
      input.brand.logo,
      '',
      input.brand.website,
      input.brand.receipt || '',
    )
}

function conversation(input: Input): ModelMessage[] {
  const history = input.messages.slice(0, -1)
  const latest = input.messages.at(-1)!
  return [
    ...history.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    ...referenceMessages(latest.text, input.attachments),
  ]
}

/**
 * Renders a new mockup from the brand logo and attachments, or edits the
 * previous image when revising (the revision keeps that image's advertiser).
 */
async function renderMockup(
  session: MockupSession,
  job: {
    previous: MockupImage | null
    logo: string | null
    attachments: Input['attachments']
    advertiser: string
    prompt: string
  },
): Promise<MockupImage> {
  const { previous, attachments } = job
  const logo = previous ? null : job.logo
  const references = [
    previous?.dataUrl ?? logo,
    ...attachments.map((file) => file.dataUrl),
  ].filter((value): value is string => !!value)
  const dataUrl = await renderBillboard(
    billboardImagePrompt(job.prompt, {
      revision: !!previous,
      logo: !!logo,
      labels: attachments.map(attachmentLabel),
    }),
    references,
  )
  const id = randomUUID()
  const name = previous?.advertiser || job.advertiser.trim()
  return {
    id,
    advertiser: name,
    dataUrl,
    receipt: await signArtifact(session, 'image', dataUrl, name, id),
  }
}

/** Tools capture the logo and image out of band; the model only sees whether they exist. */
function wizardTools(session: MockupSession, input: Input) {
  const captured: { brand: Brand | null; image: MockupImage | null } = {
    brand: input.brand,
    image: null,
  }
  const tools = {
    review_website: tool({
      description:
        'Fetch the advertiser’s public website to learn its services, tone, colors and typography, and capture its logo for the mockup.',
      inputSchema: z.object({
        url: z.string().max(2000).describe('The advertiser’s website URL.'),
      }),
      execute: async ({ url }) => {
        const review = await reviewWebsite(url.trim())
        captured.brand = {
          website: url.trim(),
          logo: review.logo,
          receipt: review.logo
            ? await signArtifact(session, 'logo', review.logo, '', url.trim())
            : null,
        }
        return {
          website: url.trim(),
          logoCaptured: !!review.logo,
          note: review.fallback,
          evidence: review.text,
        }
      },
    }),
    generate_billboard: tool({
      description:
        'Render the billboard mockup image and show it to the user. Use revision=true to edit the current mockup.',
      inputSchema: z.object({
        advertiser: z.string().min(1).max(2000),
        prompt: z
          .string()
          .min(1)
          .max(8000)
          .describe(
            'Complete creative brief with exact quoted copy, colors, tone and layout; for revisions, only the changes.',
          ),
        revision: z.boolean(),
      }),
      execute: async ({ advertiser, prompt, revision }) => {
        try {
          captured.image = await renderMockup(session, {
            previous: revision ? input.image : null,
            logo: captured.brand?.logo ?? null,
            attachments: input.attachments,
            advertiser,
            prompt,
          })
          return {
            ok: true,
            note: 'The mockup is now displayed to the user below your reply.',
          }
        } catch (error) {
          logFailure('image-rendering', error)
          return {
            ok: false,
            error:
              'The image could not be generated. The user’s current mockup is unchanged.',
          }
        }
      },
    }),
  }
  return { tools, captured }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json(
      { error: 'Please sign in again.' },
      { status: 401 },
    )
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success)
    return NextResponse.json({ error: 'Invalid message.' }, { status: 400 })
  if (!(await rateLimit('mockup-chat', session.userId, 20, 60)).allowed)
    return NextResponse.json(
      { error: 'Please wait a minute before continuing.' },
      { status: 429 },
    )
  try {
    await verifyArtifacts(session, input.data)
  } catch {
    return NextResponse.json(
      {
        error:
          'This mockup no longer belongs to your session. Download it, then start a new mockup.',
      },
      { status: 400 },
    )
  }
  let stage = 'configuration'
  try {
    const provider = createOpenAI({
      apiKey: serverConfig.openai.requireApiKey(),
    })
    stage = 'system-prompt'
    const { prompt } = await getSystemPrompt()
    const { tools, captured } = wizardTools(session, input.data)
    stage = 'conversation'
    const result = await generateText({
      model: provider('gpt-5.4-mini'),
      system: `${prompt}\n\n${toolInstructions}`,
      messages: conversation(input.data),
      tools,
      stopWhen: stepCountIs(6),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(280_000),
    })
    const reply =
      result.text.trim() ||
      (captured.image
        ? 'Your mockup is ready. Check every word before sharing, then tell me what you’d like to change.'
        : '')
    if (!reply) throw new Error('Empty reply')
    return NextResponse.json(
      { reply, image: captured.image, brand: captured.brand },
      { headers },
    )
  } catch (error) {
    logFailure(stage, error)
    return NextResponse.json(
      {
        error:
          'The wizard could not respond. Your conversation and selected image are unchanged. Please try again.',
      },
      { status: 502 },
    )
  }
}

function logFailure(stage: string, error: unknown) {
  // Log only provider metadata, never prompts, messages, credentials, or images.
  const provider = APICallError.isInstance(error) ? error : undefined
  const details = z
    .object({
      code: z.string().max(100).nullable().optional(),
      status: z.number().optional(),
      request_id: z.string().max(200).optional(),
    })
    .safeParse(error instanceof Error && error.cause ? error.cause : error)
  console.error('Mockup wizard failed', {
    stage,
    errorType: error instanceof Error ? error.name : 'UnknownError',
    statusCode: provider?.statusCode,
    requestId: provider?.responseHeaders?.['x-request-id'],
    ...(details.success ? details.data : {}),
  })
}
