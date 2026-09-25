import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import OpenAI, { toFile } from 'openai'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { getImageGenerationPrompt } from '@/lib/mockup/image-prompt'
import { attachmentsSchema, attachmentLabel } from '@/lib/mockup/attachments'
import {
  newImageInstructions,
  revisionInstructions,
  uploadedInstructions,
} from '@/lib/mockup/instructions'
import {
  intakeSchema,
  summarySchema,
  imageSchema,
  sameAdvertiser,
} from '@/lib/mockup/intake'
import {
  signArtifact,
  verifyArtifact,
  verifyImage,
} from '@/lib/mockup/receipts'

export const maxDuration = 240
const schema = z.object({
  intake: intakeSchema,
  summary: summarySchema,
  approved: z.boolean(),
  revision: z.string().max(4000).default(''),
  previous: imageSchema.nullable().default(null),
  logo: z.string().max(410_000).nullable().default(null),
  logoReceipt: z.string().max(6000).nullable().default(null),
  brandNotes: z.string().max(1200).default(''),
  attachments: attachmentsSchema,
})

async function generationPrompt({
  intake,
  summary,
  previous,
  revision,
  logo,
  brandNotes,
  attachments,
}: z.infer<typeof schema>) {
  const advertiser = intake.advertiser || ''
  const uploaded = uploadedInstructions(
    attachments.map(attachmentLabel),
    !!previous,
    !!logo,
  )
  // The selected image, not the initial brief/logo, owns all accumulated revisions.
  // Otherwise a later "bigger text" request could resurrect previously removed copy.
  if (previous) return revisionInstructions(advertiser, revision, uploaded)
  return newImageInstructions(
    await getImageGenerationPrompt(),
    !!logo,
    !!attachments.length,
    uploaded,
    {
      advertiser,
      boardType: intake.boardType,
      market: intake.market,
      goal: intake.goal,
      focus: intake.focus,
      tone: intake.tone,
      ...summary,
    },
    brandNotes,
  )
}

async function verifyReferences(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  { intake, previous, logo, logoReceipt }: z.infer<typeof schema>,
) {
  const advertiser = intake.advertiser || ''
  if (previous) {
    await verifyImage(session, previous)
    if (!sameAdvertiser(previous.advertiser, advertiser))
      throw new Error('Advertiser mismatch')
  }
  if (logo)
    await verifyArtifact(
      session,
      'logo',
      logo,
      advertiser,
      intake.website || '',
      logoReceipt || '',
    )
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json(
      { error: 'Please sign in again.' },
      { status: 401 },
    )
  const input = schema.safeParse(await request.json())
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid mockup request.' },
      { status: 400 },
    )
  const { intake, previous, revision, logo, approved } = input.data
  if ((!previous && !approved) || (previous && !revision.trim()))
    return NextResponse.json(
      { error: 'Approve the brief before generating.' },
      { status: 400 },
    )
  let stage = 'configuration'
  try {
    const client = new OpenAI({
      apiKey: serverConfig.openai.requireApiKey(),
      maxRetries: 0,
      timeout: 180_000,
    })
    const advertiser = intake.advertiser || ''
    if (!advertiser.trim())
      return NextResponse.json(
        { error: 'Add an advertiser name in the brief before generating.' },
        { status: 400 },
      )
    stage = 'reference-validation'
    await verifyReferences(session, input.data)
    const references = [
      ...(previous ? [previous.dataUrl] : [logo]),
      ...input.data.attachments.map((file) => file.dataUrl),
    ].filter((value): value is string => !!value)
    const options = {
      model: 'gpt-image-2.5-sunburst',
      prompt: await generationPrompt(input.data),
      n: 1,
      size: '1536x1024' as const,
      quality: 'high' as const,
      output_format: 'jpeg' as const,
      output_compression: 80,
    }
    stage = 'image-rendering'
    const result = references.length
      ? await client.images.edit({
          ...options,
          image: await Promise.all(
            references.map(async (data, index) =>
              toFile(
                Buffer.from(data.split(',')[1], 'base64'),
                `reference-${index}`,
                { type: data.slice(5, data.indexOf(';')) },
              ),
            ),
          ),
        })
      : await client.images.generate(options)
    const encoded = result.data?.[0]?.b64_json
    if (!encoded || encoded.length > 2_750_000)
      throw new Error('No usable image returned')
    const dataUrl = `data:image/jpeg;base64,${encoded}`
    const id = randomUUID()
    stage = 'image-signing'
    const receipt = await signArtifact(
      session,
      'image',
      dataUrl,
      advertiser,
      id,
    )
    return NextResponse.json(
      {
        image: { id, advertiser, dataUrl, receipt },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const metadata = generationFailureDetails(error)
    console.error('Mockup generation failed', {
      stage,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      ...metadata,
    })
    return NextResponse.json(
      {
        error:
          'The image could not be generated. Your selected image is unchanged. Check the brief and try again.',
      },
      { status: 502 },
    )
  }
}

function generationFailureDetails(error: unknown) {
  // Log only provider metadata, never prompts, messages, credentials, or images.
  const details = z
    .object({
      code: z.string().max(100).nullable().optional(),
      status: z.number().optional(),
      request_id: z.string().max(200).optional(),
    })
    .safeParse(error instanceof Error && error.cause ? error.cause : error)
  return details.success ? details.data : {}
}
