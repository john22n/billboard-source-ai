import path from 'node:path'
import sharp from 'sharp'
import { type ArtworkFormat, mockupPage } from './formats'

// Measured against the supplied PDFs rasterized at 144 DPI. Include the
// antialiased outer edge so no green placeholder seam survives compositing.
const faces = {
  bulletin: { left: 133, top: 540, width: 968, height: 283 },
  poster: { left: 137, top: 471, width: 960, height: 444 },
} as const

/** Compose the ad, never regenerate the brand sheet or billboard photograph. */
export async function composeMockup(artwork: string, format: ArtworkFormat) {
  const { left, top, width, height } = faces[format]
  const face = await sharp(Buffer.from(artwork.split(',')[1], 'base64'))
    // PDF rectangles differ from the nominal ratios by subpixel rounding.
    // Cover trims less than one pixel rather than distorting the campaign.
    .resize(width, height, { fit: 'cover' })
    .toBuffer()
  const sheet = sharp(
    path.join(process.cwd(), 'public', 'mockup', `${format}-template.png`),
  ).composite([{ input: face, left, top }])
  for (const quality of [85, 75, 65, 55]) {
    const buffer = await sheet.clone().jpeg({ quality }).toBuffer()
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`
    if (dataUrl.length <= 1_000_000) return dataUrl
  }
  throw new Error('Mockup exceeds the image payload limit')
}

/** New sheets are cropped for revisions; legacy flat artwork passes through. */
export async function revisionArtwork(dataUrl: string) {
  const image = sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
  const metadata = await image.metadata()
  if (
    metadata.width !== mockupPage.width ||
    metadata.height !== mockupPage.height
  )
    return dataUrl
  const buffer = await image
    .extract(faces.bulletin)
    .jpeg({ quality: 95 })
    .toBuffer()
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}
