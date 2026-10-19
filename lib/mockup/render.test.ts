import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateObject } from 'ai'
import sharp from 'sharp'
import { renderBillboard } from './render'

vi.mock('ai', () => ({
  generateObject: vi.fn(async () => ({ object: { top: 80 } })),
}))

const jpeg = 'data:image/jpeg;base64,/9j/2Q=='
const png = 'data:image/png;base64,iVBORw0KGgo='
const canvas = await sharp({
  create: {
    width: 2304,
    height: 768,
    channels: 3,
    background: '#203a56',
  },
})
  .png()
  .toBuffer()
let sent: Request
const fetcher = vi.fn<typeof fetch>(async (input, init) => {
  sent = new Request(input, init)
  return Response.json({
    created: 1,
    data: [{ b64_json: canvas.toString('base64') }],
  })
})

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'direct-test-key')
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockClear()
  vi.mocked(generateObject).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each([[], [png, jpeg]])(
  'sends image generation and edits directly to OpenAI (references: %j)',
  async (...references) => {
    const output = await renderBillboard('Alpine billboard', references)
    expect(
      await sharp(Buffer.from(output.split(',')[1], 'base64')).metadata(),
    ).toMatchObject({ format: 'jpeg', width: 2304, height: 672 })
    expect(sent.url).toBe(
      `https://api.openai.com/v1/images/${references.length ? 'edits' : 'generations'}`,
    )
    expect(sent.headers.get('authorization')).toBe('Bearer direct-test-key')
    const expected = {
      model: 'gpt-image-2.5-sunburst',
      size: '2304x768',
      quality: 'high',
      output_format: 'jpeg',
    }
    if (references.length) {
      const form = await sent.formData()
      for (const [key, value] of Object.entries(expected))
        expect(form.get(key)).toBe(value)
      expect(form.get('prompt')).toContain('Alpine billboard')
      expect(form.get('prompt')).toContain('crop it to 2304×672')
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
      expect(await sent.json()).toMatchObject({
        ...expected,
        prompt: expect.stringContaining('crop it to 2304×672'),
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

it('returns a 2304×672 bulletin using the AI-selected off-center crop without stretching', async () => {
  // Asymmetric markers: centering, reversing the offset or resizing loses them.
  const source = await sharp(
    Buffer.from(`<svg width="2304" height="768">
    <rect width="2304" height="768" fill="white"/>
    <rect y="80" width="2304" height="32" fill="red"/>
    <rect y="704" width="2304" height="48" fill="blue"/>
  </svg>`),
  )
    .png()
    .toBuffer()
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [{ b64_json: source.toString('base64') }] }),
  )
  const dataUrl = await renderBillboard('Alpine billboard', [])
  const decoded = sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
  expect(await decoded.metadata()).toMatchObject({
    format: 'jpeg',
    width: 2304,
    height: 672,
  })
  const { data, info } = await decoded
    .raw()
    .toBuffer({ resolveWithObject: true })
  for (const [y, expected] of [
    [16, [255, 0, 0]],
    [656, [0, 0, 255]],
  ] as const) {
    const offset = (y * info.width + 128) * info.channels
    expected.forEach((channel, index) =>
      expect(Math.abs(data[offset + index] - channel)).toBeLessThan(5),
    )
  }
})

it.each([0, 96])(
  'accepts crop boundary %s with exact decoded dimensions',
  async (top) => {
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { top },
    } as Awaited<ReturnType<typeof generateObject>>)
    const output = await renderBillboard('Alpine', [jpeg])
    expect(
      await sharp(Buffer.from(output.split(',')[1], 'base64')).metadata(),
    ).toMatchObject({ width: 2304, height: 672 })
  },
)

it.each([{ top: -1 }, { top: 97 }, { top: 48.5 }, { top: '80' }, {}, null])(
  'rejects invalid AI crop %j without falling back to center or returning a wrong ratio',
  async (object) => {
    vi.mocked(generateObject).mockResolvedValueOnce({ object } as Awaited<
      ReturnType<typeof generateObject>
    >)
    await expect(renderBillboard('Alpine', [])).rejects.toThrow(
      'Invalid bulletin crop position',
    )
  },
)

it('fails explicitly when vision refuses or times out', async () => {
  vi.mocked(generateObject).mockRejectedValueOnce(
    new Error('No object generated'),
  )
  await expect(renderBillboard('Alpine', [])).rejects.toThrow(
    'No object generated',
  )
})

it('generates the poster at 2496×1152 without a crop', async () => {
  const poster = await sharp({
    create: { width: 2496, height: 1152, channels: 3, background: '#203a56' },
  })
    .png()
    .toBuffer()
  fetcher.mockImplementationOnce(async (input, init) => {
    sent = new Request(input, init)
    return Response.json({ data: [{ b64_json: poster.toString('base64') }] })
  })
  const output = await renderBillboard('Same campaign', [jpeg], 'poster')
  const form = await sent.formData()
  expect(form.get('size')).toBe('2496x1152')
  expect(form.get('prompt')).toContain('finished, cropped bulletin')
  expect(
    await sharp(Buffer.from(output.split(',')[1], 'base64')).metadata(),
  ).toMatchObject({ format: 'jpeg', width: 2496, height: 1152 })
  expect(generateObject).not.toHaveBeenCalled()
})

it('rejects a provider canvas with the wrong dimensions instead of resizing it', async () => {
  await expect(renderBillboard('Poster', [jpeg], 'poster')).rejects.toThrow(
    'Unexpected artwork canvas dimensions',
  )
})

it.each([
  ['bulletin', 24, false],
  ['poster', 25, false],
  ['poster', 24, true],
] as const)(
  'bounds detailed %s artwork (texture shift %s, exceeds budget %s) without resizing',
  async (format, shift, exceedsBudget) => {
    const width = format === 'bulletin' ? 2304 : 2496
    const height = format === 'bulletin' ? 768 : 1152
    // Deterministic high-frequency texture: requires recompression, not just a size check.
    let seed = 17
    const pixels = Buffer.alloc(width * height * 3)
    for (let index = 0; index < pixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      pixels[index] = seed >>> shift
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer()
    expect(source.toString('base64').length).toBeGreaterThan(1_000_000)
    fetcher.mockResolvedValueOnce(
      Response.json({ data: [{ b64_json: source.toString('base64') }] }),
    )
    if (exceedsBudget) {
      await expect(renderBillboard('Alpine', [], format)).rejects.toThrow(
        'Artwork exceeds the image payload limit',
      )
      return
    }
    const output = await renderBillboard('Alpine', [], format)
    expect(output.length).toBeLessThanOrEqual(1_000_000)
    expect(
      await sharp(Buffer.from(output.split(',')[1], 'base64')).metadata(),
    ).toMatchObject({
      width,
      height: format === 'bulletin' ? 672 : 1152,
    })
  },
)
