import OpenAI, { toFile } from 'openai'
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
  const encoded = result.data?.[0]?.b64_json
  // Leave room in browser storage for the pair, an original pair awaiting
  // attachment retry, the uploaded reference, website logo and chat history.
  // Subsequent requests also stay below Vercel's 4.5 MB body limit.
  if (!encoded || encoded.length > 999_977)
    throw new Error('No usable image returned')
  return `data:image/jpeg;base64,${encoded}`
}
