import OpenAI, { toFile } from 'openai'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import sharp, { type Sharp } from 'sharp'
import { z } from 'zod'
import { serverConfig } from '@/lib/config'
import { artworkFormats, type ArtworkFormat } from './formats'
import { cropInstructions, flatArtworkPrompt } from './instructions'

const cropSchema = z.object({ top: z.number().int().min(0).max(96) }).strict()

async function selectBulletinCrop(source: Buffer) {
  const provider = createOpenAI({ apiKey: serverConfig.openai.requireApiKey() })
  const result = await generateObject({
    model: provider('gpt-5.4-mini'),
    schema: cropSchema,
    providerOptions: { openai: { strictJsonSchema: true } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(60_000),
    system: cropInstructions,
    messages: [{ role: 'user', content: [{ type: 'image', image: source }] }],
  })
  const crop = cropSchema.safeParse(result.object)
  if (!crop.success) throw new Error('Invalid bulletin crop position')
  return crop.data.top
}

/** Reduce bytes, never pixels. Fail rather than return an oversized artifact. */
async function boundedJpeg(image: Sharp) {
  for (const quality of [80, 70, 60, 50]) {
    const buffer = await image.clone().jpeg({ quality }).toBuffer()
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`
    // Room for the pair, an original pair awaiting attachment retry, uploads,
    // website logo and chat history; requests also fit Vercel's 4.5 MB limit.
    if (dataUrl.length <= 1_000_000) return dataUrl
  }
  throw new Error('Artwork exceeds the image payload limit')
}

/**
 * References are ordered: logo/current bulletin first, then uploads. The poster
 * receives the finished bulletin. Geometry is verified before signing artifacts.
 */
export async function renderBillboard(
  prompt: string,
  references: string[],
  format: ArtworkFormat = 'bulletin',
) {
  const client = new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
    maxRetries: 0,
    timeout: 180_000,
  })
  const { width, height, canvasHeight } = artworkFormats[format]
  const options = {
    model: 'gpt-image-2.5-sunburst',
    prompt: flatArtworkPrompt(prompt, format),
    n: 1,
    // Sunburst supports custom dimensions; openai@5's size union predates it.
    size: `${width}x${canvasHeight}` as OpenAI.ImageEditParams['size'],
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
  // Bound provider data before decoding; this intermediate never reaches the UI.
  if (!encoded || encoded.length > 16_000_000)
    throw new Error('No usable image returned')
  const source = Buffer.from(encoded, 'base64')
  const image = sharp(source, { limitInputPixels: width * canvasHeight })
  const metadata = await image.metadata()
  if (metadata.width !== width || metadata.height !== canvasHeight)
    throw new Error('Unexpected artwork canvas dimensions')
  if (metadata.orientation && metadata.orientation !== 1)
    throw new Error('Unexpected artwork orientation')
  if (format === 'bulletin') {
    const top = await selectBulletinCrop(source)
    image.extract({ left: 0, top, width, height })
  }
  return boundedJpeg(image)
}
