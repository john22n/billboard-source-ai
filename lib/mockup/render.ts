import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { serverConfig } from '@/lib/config'

/**
 * Renders one billboard image. `references` are data URLs supplied in the
 * order the prompt describes them (logo or current mockup first, then uploads).
 */
export async function renderBillboard(prompt: string, references: string[]) {
  const client = new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
    maxRetries: 0,
    timeout: 180_000,
  })
  const options = {
    model: 'gpt-image-2.5-sunburst',
    prompt,
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
  let encoded = result.data?.[0]?.b64_json
  if (!encoded) throw new Error('No usable image returned')
  // Two images, logo, upload and conversation must fit below Vercel's 4.5 MB
  // request limit on subsequent turns. Recompress pixels, never stretch faces.
  const bytes = Buffer.from(encoded, 'base64')
  for (const quality of [75, 60, 45]) {
    if (encoded.length <= 1_499_976) break
    encoded = (await sharp(bytes).jpeg({ quality }).toBuffer()).toString(
      'base64',
    )
  }
  if (encoded.length > 1_499_976)
    throw new Error('Image exceeds the transfer budget')
  return `data:image/jpeg;base64,${encoded}`
}
