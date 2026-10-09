import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { renderBillboard } from './render'

vi.mock('ai', () => ({
  generateObject: vi.fn(async () => ({ object: { top: 80 } })),
}))

const jpeg = 'data:image/jpeg;base64,/9j/2Q=='
const png = 'data:image/png;base64,iVBORw0KGgo='
let sent: Request
const fetcher = vi.fn<typeof fetch>(async (input, init) => {
  sent = new Request(input, init)
  return Response.json({ created: 1, data: [{ b64_json: '/9j/2Q==' }] })
})

beforeEach(() => {
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
    expect(await renderBillboard('Alpine billboard', references)).toBe(jpeg)
    expect(sent.url).toBe(
      `https://api.openai.com/v1/images/${references.length ? 'edits' : 'generations'}`,
    )
    expect(sent.headers.get('authorization')).toBe('Bearer direct-test-key')
    const expected = {
      model: 'gpt-image-2.5-sunburst',
      prompt: 'Alpine billboard',
      size: '1536x1024',
      quality: 'high',
      output_format: 'jpeg',
    }
    if (references.length) {
      const form = await sent.formData()
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
      expect(await sent.json()).toMatchObject({
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

it('bounds each image so a pair and its pending attachment snapshot fit browser storage', async () => {
  const withinBudget = 'A'.repeat(999_976)
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [{ b64_json: withinBudget }] }),
  )
  expect(await renderBillboard('Alpine billboard', [])).toBe(
    `data:image/jpeg;base64,${withinBudget}`,
  )
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [{ b64_json: 'A'.repeat(1_000_000) }] }),
  )
  await expect(renderBillboard('Alpine billboard', [])).rejects.toThrow(
    'No usable image returned',
  )
})
