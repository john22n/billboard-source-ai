import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { serverConfig } from '@/lib/config'

const faces = {
  bulletin: {
    width: 1536,
    height: 512,
    cropHeight: 448,
    displayWidth: 1344,
    displayHeight: 392,
  },
  poster: {
    width: 1248,
    height: 576,
    cropHeight: 576,
    displayWidth: 1248,
    displayHeight: 576,
  },
} as const

/** The AI never generates the surroundings: every campaign uses this template. */
function presentation(width: number, height: number) {
  const left = (1536 - width) / 2
  const bottom = 180 + height
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#4f9cdb"/><stop offset="1" stop-color="#e8f5fc"/></linearGradient>
      <linearGradient id="pole"><stop stop-color="#353b40"/><stop offset=".45" stop-color="#a4adb3"/><stop offset=".75" stop-color="#667078"/><stop offset="1" stop-color="#30363b"/></linearGradient>
      <filter id="cloud"><feGaussianBlur stdDeviation="24"/></filter>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="6" flood-opacity=".3"/></filter>
    </defs>
    <rect width="1536" height="1024" fill="url(#sky)"/>
    <g fill="white" opacity=".65" filter="url(#cloud)">
      <ellipse cx="160" cy="80" rx="300" ry="32"/><ellipse cx="420" cy="115" rx="260" ry="25"/>
      <ellipse cx="1290" cy="110" rx="330" ry="36"/><ellipse cx="1510" cy="350" rx="220" ry="60"/>
      <ellipse cx="40" cy="490" rx="230" ry="60"/><ellipse cx="210" cy="530" rx="250" ry="38"/>
      <ellipse cx="1230" cy="850" rx="430" ry="62"/><ellipse cx="200" cy="920" rx="350" ry="58"/>
    </g>
    <rect x="720" y="${bottom}" width="96" height="${1024 - bottom}" fill="url(#pole)"/>
    <rect x="${left - 8}" y="172" width="${width + 16}" height="${height + 16}" rx="2" fill="#41484d" filter="url(#shadow)"/>
    <rect x="${left - 12}" y="${bottom + 8}" width="${width + 24}" height="12" fill="#727d84"/>
    ${[0.15, 0.38, 0.62, 0.85].map((position) => `<path d="M${left + width * position} ${bottom + 10}v14" stroke="#41484d" stroke-width="5"/><rect x="${left + width * position - 19}" y="${bottom + 20}" width="38" height="14" rx="4" fill="#69757e" stroke="#b7c0c5" stroke-width="2"/>`).join('')}
  </svg>`)
}

/**
 * Renders one billboard image. `references` are data URLs supplied in the
 * order the prompt describes them (logo or current mockup first, then uploads).
 */
export async function renderBillboard(
  prompt: string,
  references: string[],
  format: keyof typeof faces = 'bulletin',
) {
  const client = new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
    maxRetries: 0,
    timeout: 180_000,
  })
  const { width, height, cropHeight, displayWidth, displayHeight } =
    faces[format]
  const options = {
    model: 'gpt-image-2.5-sunburst',
    prompt: `${prompt}\n\nMandatory application output rules override conflicting staging instructions above or in references: Generate only the flat advertisement face, edge-to-edge at ${width}×${height}. The application trims ${(height - cropHeight) / 2} pixels from each of the top and bottom edges; keep all text, logos and essential imagery inside the central ${width}×${cropHeight} area. No sky outside the advertisement, surrounding scenery, billboard structures, poles, lighting hardware, perspective, borders, presentation logos or footers. The application places the artwork into a fixed blue-sky, single-pole template. Preserve the advertiser's logo, copy and creative imagery. If a reference is a staged billboard, extract only its advertisement. Background imagery requested by the advertiser belongs inside the advertisement, never around the board. Return one ${format} face, not multiple boards or a collage.`,
    n: 1,
    // This model supports custom sizes; openai@5's union predates it.
    size: `${width}x${height}` as OpenAI.ImageEditParams['size'],
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
  if (!encoded || encoded.length > 16_000_000)
    throw new Error('No usable image returned')
  const face = sharp(Buffer.from(encoded, 'base64'), {
    limitInputPixels: width * height,
  })
  const metadata = await face.metadata()
  if (
    metadata.width !== width ||
    metadata.height !== height ||
    (metadata.orientation && metadata.orientation !== 1)
  )
    throw new Error('Unexpected artwork dimensions')
  const artwork = await face
    .extract({
      left: 0,
      top: (height - cropHeight) / 2,
      width,
      height: cropHeight,
    })
    .resize(displayWidth, displayHeight)
    .png()
    .toBuffer()
  const image = sharp(presentation(displayWidth, displayHeight)).composite([
    { input: artwork, left: (1536 - displayWidth) / 2, top: 180 },
  ])
  // Keep browser storage and subsequent chat/attachment requests within budget.
  for (const quality of [80, 70, 60, 50]) {
    const buffer = await image.clone().jpeg({ quality }).toBuffer()
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`
    if (dataUrl.length <= 1_000_000) return dataUrl
  }
  throw new Error('Artwork exceeds the image payload limit')
}
