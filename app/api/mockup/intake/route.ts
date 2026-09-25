import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import {
  APICallError,
  generateObject,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { rateLimit } from '@/lib/rate-limit'
import {
  intakeSchema,
  summarySchema,
  nextQuestion,
  applyAnswers,
  questions,
  includeWebsiteCopy,
  type Intake,
} from '@/lib/mockup/intake'
import { reviewWebsite } from '@/lib/mockup/website'
import { signArtifact } from '@/lib/mockup/receipts'
import {
  extractionInstructions,
  summaryInstructions,
  summaryReferenceGuidance,
} from '@/lib/mockup/instructions'
import {
  attachmentsSchema,
  referenceMessages,
  type CreativeAttachment,
} from '@/lib/mockup/attachments'

export const maxDuration = 90
const inputSchema = z.object({
  intake: intakeSchema,
  message: z.string().max(4000).default(''),
  review: z.boolean().default(false),
  attachments: attachmentsSchema,
  attachmentInstructions: z.string().max(8000).default(''),
})

async function answerQuestion(
  intake: Intake,
  message: string,
  model: LanguageModel,
  attachments: CreativeAttachment[],
) {
  const current = nextQuestion(intake)
  if (current && /^\s*(skip|none|n\/a)\s*[.!]?\s*$/i.test(message))
    return { ...intake, [current]: '' }
  if (!message.trim()) return intake
  // Copy requests are free text, not advertiser facts to classify or discard.
  if (current === 'required') return { ...intake, required: message }
  const result = await generateObject({
    model,
    schema: intakeSchema.extend({
      boardType: z.string().max(100).nullable(),
    }),
    providerOptions: { openai: { strictJsonSchema: true } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(40_000),
    system: extractionInstructions,
    messages: referenceMessages(
      JSON.stringify({
        intake,
        currentQuestion: current,
        intakeQuestions: questions,
        latestAnswer: message,
      }),
      attachments,
    ),
  })
  return applyAnswers(intake, {
    ...result.object,
    boardType: result.object.boardType ?? intake.boardType,
  })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json(
      { error: 'Please sign in again.' },
      { status: 401 },
    )
  const input = inputSchema.safeParse(await request.json())
  if (!input.success)
    return NextResponse.json({ error: 'Invalid intake.' }, { status: 400 })
  if (!(await rateLimit('mockup-intake', session.userId, 30, 60)).allowed)
    return NextResponse.json(
      { error: 'Please wait a minute before continuing.' },
      { status: 429 },
    )
  let stage = 'configuration'
  try {
    const provider = createOpenAI({
      apiKey: serverConfig.openai.requireApiKey(),
    })
    const model = provider('gpt-5.4-mini')
    stage = 'answer-extraction'
    const intake = await answerQuestion(
      input.data.intake,
      input.data.message,
      model,
      input.data.attachments,
    )
    if (nextQuestion(intake) && !input.data.review)
      return NextResponse.json({ intake })
    stage = 'website-review'
    const website = await reviewWebsite(intake.website || '')
    stage = 'approval-summary'
    const result = await generateObject({
      model,
      schema: z.object({
        summary: summarySchema,
        brandNotes: z.string().max(1200),
        omitWebsite: z
          .boolean()
          .describe(
            'True only when the user explicitly asked not to print the website.',
          ),
      }),
      providerOptions: { openai: { strictJsonSchema: true } },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(40_000),
      system: summaryInstructions,
      messages: referenceMessages(
        JSON.stringify({
          intake,
          websiteEvidence: website.text,
          attachmentInstructions: input.data.attachmentInstructions,
          referenceGuidance: summaryReferenceGuidance,
        }),
        input.data.attachments,
      ),
    })
    stage = 'logo-signing'
    const receipt = website.logo
      ? await signArtifact(
          session,
          'logo',
          website.logo,
          intake.advertiser || '',
          intake.website || '',
        )
      : null
    return NextResponse.json(
      {
        intake,
        summary: includeWebsiteCopy(
          result.object.summary,
          intake.website,
          result.object.omitWebsite,
        ),
        brand: {
          notes: result.object.brandNotes,
          fallback: website.fallback,
          logo: website.logo,
          receipt,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    logIntakeFailure(error, stage)
    return preparationErrorResponse()
  }
}

function preparationErrorResponse() {
  return NextResponse.json(
    {
      error:
        'Could not prepare the mockup brief. Your answers are preserved; please try again.',
    },
    { status: 502 },
  )
}

function logIntakeFailure(error: unknown, stage: string) {
  const provider = APICallError.isInstance(error) ? error : undefined
  let details: { code?: string | null; type?: string; param?: string | null } =
    {}
  try {
    const parsed = z
      .object({
        error: z.object({
          code: z.string().max(100).nullable().optional(),
          type: z.string().max(100).optional(),
          param: z.string().max(100).nullable().optional(),
        }),
      })
      .safeParse(JSON.parse(provider?.responseBody || '{}'))
    if (parsed.success) details = parsed.data.error
  } catch {}
  console.error('Mockup intake failed', {
    stage,
    errorType: error instanceof Error ? error.name : 'UnknownError',
    statusCode: provider?.statusCode,
    requestId: provider?.responseHeaders?.['x-request-id'],
    ...objectFailureDetails(error),
    ...details,
  })
}

function objectFailureDetails(error: unknown) {
  if (!NoObjectGeneratedError.isInstance(error)) return {}
  return {
    requestId: error.response?.headers?.['x-request-id'],
    causeType: error.cause instanceof Error ? error.cause.name : undefined,
    finishReason: error.finishReason,
    hasText: error.text !== undefined,
  }
}
