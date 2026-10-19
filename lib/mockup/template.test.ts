import { expect, it } from 'vitest'
import sharp from 'sharp'
import { composeMockup, revisionArtwork } from './template'

it.each(['bulletin', 'poster'] as const)(
  'fills the %s face and preserves the supplied presentation sheet',
  async (format) => {
    const artwork = await sharp({
      create: { width: 2400, height: 1100, channels: 3, background: '#a02060' },
    })
      .jpeg()
      .toBuffer()
    const result = await composeMockup(
      `data:image/jpeg;base64,${artwork.toString('base64')}`,
      format,
    )
    expect(result.length).toBeLessThanOrEqual(1_000_000)
    const sheet = sharp(Buffer.from(result.split(',')[1], 'base64'))
    expect(await sheet.metadata()).toMatchObject({ width: 1224, height: 1584 })
    const { data, info } = await sheet
      .clone()
      .raw()
      .toBuffer({ resolveWithObject: true })
    // No untouched green placeholder, including antialiased edge pixels.
    let green = 0
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] < 180 && data[i + 1] > 220 && data[i + 2] < 60) green++
    expect(green).toBe(0)
    const facePixel = await sheet
      .clone()
      .extract({ left: 600, top: 650, width: 1, height: 1 })
      .raw()
      .toBuffer()
    for (const [channel, expected] of [160, 32, 96].entries())
      expect(Math.abs(facePixel[channel] - expected)).toBeLessThan(3)
    // Header, sky and footer remain the original template, allowing JPEG loss.
    for (const region of [
      { left: 0, top: 0, width: 1224, height: 210 },
      { left: 200, top: 250, width: 800, height: 150 },
      { left: 0, top: 1460, width: 1224, height: 124 },
    ]) {
      const original = await sharp(`public/mockup/${format}-template.png`)
        .removeAlpha()
        .extract(region)
        .raw()
        .toBuffer()
      const actual = await sheet
        .clone()
        .removeAlpha()
        .extract(region)
        .raw()
        .toBuffer()
      const error =
        actual.reduce(
          (sum, value, i) => sum + Math.abs(value - original[i]),
          0,
        ) / actual.length
      expect(error).toBeLessThan(5)
    }
    if (format === 'bulletin') {
      const reference = await revisionArtwork(result)
      const stats = await sharp(
        Buffer.from(reference.split(',')[1], 'base64'),
      ).stats()
      // Cropping the whole page or the poster's rectangle includes sky/branding.
      expect(stats.channels.every((channel) => channel.stdev < 10)).toBe(true)
    }
    const legacy = `data:image/jpeg;base64,${artwork.toString('base64')}`
    expect(await revisionArtwork(legacy)).toBe(legacy)
  },
)
