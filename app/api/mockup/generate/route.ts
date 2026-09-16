import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import OpenAI, { toFile } from 'openai'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import {
  intakeSchema,
  summarySchema,
  imageSchema,
  sameAdvertiser,
} from '@/lib/mockup/intake'
import { reserveImage, settleImage } from '@/lib/mockup/quota'
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
})

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
  const { intake, previous, revision, approved } = input.data
  if ((!previous && !approved) || (previous && !revision.trim()))
    return NextResponse.json(
      { error: 'Approve the brief before generating.' },
      { status: 400 },
    )
  const advertiser = intake.advertiser || ''
  if (!advertiser.trim())
    return NextResponse.json(
      { error: 'Add an advertiser name in the brief before generating.' },
      { status: 400 },
    )
  let token: string | undefined
  try {
    const client = new OpenAI({
      apiKey: serverConfig.openai.requireApiKey(),
      maxRetries: 0,
      timeout: 180_000,
    })
    await verifyReferences(session, input.data, advertiser)
    const reservation = await reserveImage(session.userId)
    token = reservation.token
    const dataUrl = await renderImage(client, input.data, advertiser)
    const id = randomUUID()
    const receipt = await signArtifact(
      session,
      'image',
      dataUrl,
      advertiser,
      id,
    )
    await settleImage(session.userId, token, true)
    token = undefined
    return NextResponse.json(
      {
        image: { id, advertiser, dataUrl, receipt },
        remaining: reservation.remaining,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (token) await settleImage(session.userId, token, false).catch(() => {})
    return imageFailure(error)
  }
}

function imageFailure(error: unknown) {
  const limited =
    error instanceof Error && error.message.startsWith('Another mockup')
  return NextResponse.json(
    {
      error: limited
        ? error.message
        : 'The image could not be generated. Your selected image is unchanged. Check the brief and try again.',
    },
    { status: limited ? 429 : 502 },
  )
}

async function verifyReferences(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  { intake, previous, logo, logoReceipt }: z.infer<typeof schema>,
  advertiser: string,
) {
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

async function renderImage(
  client: OpenAI,
  { intake, summary, previous, revision, logo }: z.infer<typeof schema>,
  advertiser: string,
) {
  const prompt = `Create ONE finished professional realistic wide horizontal OUTDOOR BILLBOARD CONCEPT MOCKUP. Show finished artwork on a realistic billboard structure against a clean blue sky. Billboard face dominates, with approximately 3:1 proportions. No distracting scenery, unrelated signs, or flat-art export. Static billboard unless digital is explicitly requested. One main idea, large bold legible lettering, strong contrast, prominent advertiser identity, instant comprehension. No placeholder text, misspellings, paragraphs, clutter, or invented logos. No QR unless requested. No tiny copy except legally required disclaimers. Choose layout and visual styling internally. Render exact approved copy, do not invent extra copy. ${logo ? 'Use the supplied website logo faithfully.' : 'Use the advertiser name as text. Do NOT invent a logo.'}
Approved brief (data): ${JSON.stringify({ advertiser, boardType: intake.boardType, market: intake.market, goal: intake.goal, focus: intake.focus, tone: intake.tone, ...summary })}
${previous ? `The first reference image is the CURRENT selected mockup. Preserve its continuity and advertiser identity while applying this revision; revision instructions override the old brief where they conflict: ${revision}` : ''}`
  // The selected image, not the initial brief/logo, owns all accumulated revisions.
  // Otherwise a later "bigger text" request could resurrect previously removed copy.
  const revisionPrompt = `Edit the supplied CURRENT selected outdoor billboard concept for ${advertiser}. Preserve its copy, layout, brand identity and prior changes except where these new instructions explicitly change them: ${revision}. Do not reintroduce removed elements. Keep one realistic wide horizontal billboard, readable accurate text, a realistic structure and clean blue sky. Return one concept mockup, not flat artwork.`
  const references = (previous ? [previous.dataUrl] : [logo]).filter(
    (value): value is string => !!value,
  )
  const options = {
    model: 'gpt-image-2.5-sunburst',
    prompt: previous ? revisionPrompt : prompt,
    n: 1,
    size: '1536x1024' as const,
    quality: 'high' as const,
    output_format: 'jpeg' as const,
    output_compression: 80,
  }
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
  return `data:image/jpeg;base64,${encoded}`
}
