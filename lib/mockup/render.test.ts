import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { renderBillboard } from './render'

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

it('compresses large outputs so two images plus references fit in a Vercel request without stretching', async () => {
  const bytes = await sharp(randomBytes(1536 * 1024 * 3), {
    raw: { width: 1536, height: 1024, channels: 3 },
  })
    .jpeg({ quality: 100 })
    .toBuffer()
  expect(bytes.toString('base64').length).toBeGreaterThan(1_500_000)
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [{ b64_json: bytes.toString('base64') }] }),
  )
  const result = await renderBillboard('A photographic mockup', [])
  expect(result.length).toBeLessThanOrEqual(1_500_000)
  expect(
    await sharp(Buffer.from(result.split(',')[1], 'base64')).metadata(),
  ).toMatchObject({
    width: 1536,
    height: 1024,
    format: 'jpeg',
  })
})
