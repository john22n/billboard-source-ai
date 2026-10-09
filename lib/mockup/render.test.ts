import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { renderBillboard } from './render'

const jpeg = 'data:image/jpeg;base64,/9j/2Q=='
const png = 'data:image/png;base64,iVBORw0KGgo='
let sent: Request
let artwork: string
const fetcher = vi.fn<typeof fetch>(async (input, init) => {
  sent = new Request(input, init)
  return Response.json({ created: 1, data: [{ b64_json: artwork }] })
})

beforeEach(async () => {
  artwork = (
    await sharp({
      create: { width: 1536, height: 512, channels: 3, background: '#cc2222' },
    })
      .png()
      .toBuffer()
  ).toString('base64')
  vi.stubEnv('OPENAI_API_KEY', 'direct-test-key')
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each([[], [png, jpeg]])(
  'sends image generation and edits directly to OpenAI (references: %j)',
  async (...references) => {
    expect(await renderBillboard('Alpine billboard', references)).toMatch(
      /^data:image\/jpeg;base64,/,
    )
    expect(sent.url).toBe(
      `https://api.openai.com/v1/images/${references.length ? 'edits' : 'generations'}`,
    )
    expect(sent.headers.get('authorization')).toBe('Bearer direct-test-key')
    const expected = {
      model: 'gpt-image-2.5-sunburst',
      size: '1536x512',
      quality: 'high',
      output_format: 'jpeg',
    }
    if (references.length) {
      const form = await sent.formData()
      expect(form.get('prompt')).toContain('Alpine billboard')
      expect(form.get('prompt')).toContain(
        'Generate only the flat advertisement face',
      )
      for (const [key, value] of Object.entries(expected))
        expect(form.get(key)).toBe(value)
      expect(form.get('output_compression')).toBe('80')
      const images = form.getAll('image[]') as File[]
      expect(images.map((image) => image.type)).toEqual([
        'image/png',
        'image/jpeg',
      ])
      expect(
        await Promise.all(
          images.map(async (image) =>
            Buffer.from(await image.arrayBuffer()).toString('base64'),
          ),
        ),
      ).toEqual(['iVBORw0KGgo=', '/9j/2Q=='])
    } else {
      const body = await sent.json()
      expect(body.prompt).toContain('Alpine billboard')
      expect(body.prompt).toContain('Generate only the flat advertisement face')
      expect(body).toMatchObject({
        ...expected,
        n: 1,
        output_compression: 80,
      })
    }
  },
)

it('rejects image requests before fetching when the OpenAI key is missing', async () => {
  vi.stubEnv('OPENAI_API_KEY', '')
  await expect(renderBillboard('Alpine billboard', [])).rejects.toThrow(
    'OPENAI_API_KEY',
  )
  expect(fetcher).not.toHaveBeenCalled()
})

it('uses the same sky and single pole for different artwork and both board formats', async () => {
  const bulletin = await renderBillboard('Denver skyline and wall mounting', [])
  artwork = (
    await sharp({
      create: { width: 1248, height: 576, channels: 3, background: '#2222cc' },
    })
      .png()
      .toBuffer()
  ).toString('base64')
  const poster = await renderBillboard(
    'Street scene with landscaping',
    [bulletin],
    'poster',
  )
  const images = await Promise.all(
    [bulletin, poster].map(async (url) => {
      expect(url.length).toBeLessThanOrEqual(1_000_000)
      const image = sharp(Buffer.from(url.split(',')[1], 'base64'))
      expect(await image.metadata()).toMatchObject({
        width: 1536,
        height: 1024,
        format: 'jpeg',
      })
      return image.raw().toBuffer({ resolveWithObject: true })
    }),
  )
  const pixel = (index: number, x: number, y: number) => {
    const { data, info } = images[index]
    const offset = (y * info.width + x) * info.channels
    return [...data.subarray(offset, offset + 3)]
  }
  for (const [x, y] of [
    [30, 40],
    [1500, 500],
    [400, 950],
    [768, 950],
  ]) {
    pixel(0, x, y).forEach((value, channel) =>
      expect(Math.abs(value - pixel(1, x, y)[channel])).toBeLessThan(5),
    )
  }
  expect(pixel(0, 768, 400)[0]).toBeGreaterThan(180)
  expect(pixel(1, 768, 400)[2]).toBeGreaterThan(180)
  expect(pixel(0, 400, 950)[2]).toBeGreaterThan(pixel(0, 400, 950)[0])
  expect(pixel(0, 400, 950)[0] - pixel(0, 730, 950)[0]).toBeGreaterThan(60)
})

it('rejects oversized or incorrectly sized provider artwork instead of stretching it', async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [{ b64_json: 'A'.repeat(16_000_001) }] }),
  )
  await expect(renderBillboard('Alpine billboard', [])).rejects.toThrow(
    'No usable image returned',
  )
  artwork = (
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer()
  ).toString('base64')
  await expect(renderBillboard('Alpine billboard', [])).rejects.toThrow(
    'Unexpected artwork dimensions',
  )
})
