import { beforeEach, expect, it, vi } from 'vitest'
import { freshIntake } from '@/lib/mockup/intake'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  database: vi.fn(() => {
    throw new Error('Quota database must not be used')
  }),
}))
vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', sessionStartedAt: 123 }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test' } },
}))
vi.mock('@/db', () => ({ db: { execute: mocks.database } }))
vi.mock('@/lib/mockup/image-prompt', () => ({
  getImageGenerationPrompt: async () => 'Create a billboard concept.',
}))
vi.mock('@/lib/mockup/receipts', () => ({
  signArtifact: async () => 'signed',
  verifyArtifact: vi.fn(),
  verifyImage: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
    images = { generate: mocks.generate, edit: mocks.edit }
  },
  toFile: async (bytes: Buffer) => bytes,
}))
import { POST } from './route'
const brief = {
  intake: { ...freshIntake(), advertiser: 'Alpine' },
  summary: {
    headline: 'Smile bigger',
    supporting: '',
    contact: '',
    direction: 'Bold',
    caution: '',
  },
  approved: true,
}
const request = (body: unknown) =>
  new Request('http://localhost/api/mockup/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.generate.mockReset()
  mocks.edit.mockReset()
})

it('does not call OpenAI before explicit initial approval', async () => {
  expect((await POST(request({ ...brief, approved: false }))).status).toBe(400)
  expect(mocks.generate).not.toHaveBeenCalled()
})
it('uses an uploaded logo as an image reference rather than generating from text alone', async () => {
  mocks.edit.mockResolvedValueOnce({ data: [{ b64_json: '/9j/2Q==' }] })
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const response = await POST(
    request({
      ...brief,
      attachments: [
        {
          id: 'logo-1',
          name: 'alpine-logo.png',
          sourceType: 'image/png',
          dataUrl,
        },
      ],
    }),
  )
  expect(response.status).toBe(200)
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(mocks.edit.mock.calls[0][0].image).toEqual([
    Buffer.from(dataUrl.split(',')[1], 'base64'),
  ])
  expect(mocks.edit.mock.calls[0][0].prompt).toContain('alpine-logo.png')
})

it.each([
  'https://internal.example/image.png',
  'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  'data:image/png;base64,PGh0bWw+',
  'data:image/jpeg;base64,invalid!',
  `data:image/jpeg;base64,/9j/${'A'.repeat(400_000)}`,
])(
  'rejects invalid or oversized references without a provider call (case %#)',
  async (dataUrl) => {
    const response = await POST(
      request({
        ...brief,
        attachments: [
          { id: 'bad', name: 'bad.png', sourceType: 'image/png', dataUrl },
        ],
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.edit).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  },
)

it('accepts one reference but rejects a second file', async () => {
  const file = {
    id: 'ref',
    name: 'ref.jpg',
    sourceType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  }
  mocks.edit.mockResolvedValue({ data: [{ b64_json: '/9j/2Q==' }] })
  expect((await POST(request({ ...brief, attachments: [file] }))).status).toBe(
    200,
  )
  expect(mocks.edit.mock.calls[0][0].image).toHaveLength(1)
  expect(
    (await POST(request({ ...brief, attachments: [file, file] }))).status,
  ).toBe(400)
  expect(mocks.edit).toHaveBeenCalledTimes(1)
})

it('keeps the selected revision first and adds the uploaded PDF background as a separate reference', async () => {
  mocks.edit.mockResolvedValueOnce({ data: [{ b64_json: '/9j/2Q==' }] })
  const previous = {
    id: '12345678-1234-4123-8123-123456789abc',
    advertiser: 'Alpine',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    receipt: 'signed',
  }
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const response = await POST(
    request({
      ...brief,
      previous,
      revision: 'Place it on the attached background',
      approved: false,
      attachments: [
        {
          id: 'background',
          name: 'scene.pdf',
          sourceType: 'application/pdf',
          pageNumber: 3,
          pageCount: 4,
          searchQuery: 'mountain background',
          dataUrl,
        },
      ],
    }),
  )
  expect(response.status).toBe(200)
  expect(mocks.edit.mock.calls[0][0].image).toEqual([
    Buffer.from('/9j/2Q==', 'base64'),
    Buffer.from(dataUrl.split(',')[1], 'base64'),
  ])
  expect(mocks.edit.mock.calls[0][0].prompt).toContain('PDF page 3 of 4')
  expect(mocks.edit.mock.calls[0][0].prompt).toContain(
    'Selected for: mountain background',
  )
  expect(mocks.edit.mock.calls[0][0].prompt).toContain(
    'Place it on the attached background',
  )
})
it('uses the selected image as the revision reference and reports a failed request', async () => {
  mocks.edit.mockRejectedValueOnce(new Error('Provider failure'))
  const previous = {
    id: '12345678-1234-4123-8123-123456789abc',
    advertiser: 'Alpine',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    receipt: 'signed',
  }
  const response = await POST(
    request({ ...brief, previous, revision: 'Bigger text', approved: false }),
  )
  expect(response.status).toBe(502)
  expect(mocks.edit.mock.calls[0][0].image[0]).toEqual(
    Buffer.from('/9j/2Q==', 'base64'),
  )
  expect(mocks.edit.mock.calls[0][0].prompt).toContain('Bigger text')
  expect(mocks.edit.mock.calls[0][0].prompt).not.toContain('Smile bigger')
  expect(mocks.edit.mock.calls[0][0].image).toHaveLength(1)
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(mocks.database).not.toHaveBeenCalled()
})
it('returns a signed, session-only image without quota metadata', async () => {
  mocks.generate.mockResolvedValueOnce({ data: [{ b64_json: '/9j/2Q==' }] })
  const response = await POST(request(brief))
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result).toMatchObject({
    image: {
      advertiser: 'Alpine',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      receipt: 'signed',
    },
  })
  expect(result).not.toHaveProperty('remaining')
  expect(mocks.generate.mock.calls[0][0].n).toBe(1)
  expect(mocks.database).not.toHaveBeenCalled()
})

it('passes the approved website palette to image generation as visual direction', async () => {
  mocks.generate.mockResolvedValueOnce({ data: [{ b64_json: '/9j/2Q==' }] })
  const response = await POST(
    request({
      ...brief,
      summary: {
        ...brief.summary,
        direction:
          'Website palette: navy #14283f background, orange #ed7b32 accents, cream #f9e7c4 text.',
      },
    }),
  )
  expect(response.status).toBe(200)
  const prompt = mocks.generate.mock.calls[0][0].prompt
  expect(prompt).toContain('#14283f')
  expect(prompt).toContain('#ed7b32')
  expect(prompt).toContain('#f9e7c4')
})

it('passes website brand evidence and approved URL copy to the initial image request', async () => {
  mocks.generate.mockResolvedValueOnce({ data: [{ b64_json: '/9j/2Q==' }] })
  const response = await POST(
    request({
      ...brief,
      summary: { ...brief.summary, contact: 'alpine.example' },
      brandNotes: 'Website uses condensed serif headings.',
    }),
  )
  expect(response.status).toBe(200)
  const prompt = mocks.generate.mock.calls[0][0].prompt
  expect(prompt).toContain('condensed serif')
  expect(prompt).toContain('alpine.example')
})

it('records safe provider metadata without leaking its message', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.generate.mockRejectedValueOnce(
    Object.assign(new Error('Private image prompt and credentials'), {
      status: 403,
      code: 'permission_denied',
      request_id: 'req_image',
    }),
  )
  const response = await POST(request(brief))
  expect(response.status).toBe(502)
  expect(log).toHaveBeenCalledWith('Mockup generation failed', {
    stage: 'image-rendering',
    errorType: 'Error',
    status: 403,
    code: 'permission_denied',
    request_id: 'req_image',
  })
  expect(JSON.stringify([log.mock.calls, await response.json()])).not.toContain(
    'Private',
  )
})

it('allows more than ten generations and revisions without consulting quota storage', async () => {
  mocks.generate.mockResolvedValue({ data: [{ b64_json: '/9j/2Q==' }] })
  mocks.edit.mockResolvedValue({ data: [{ b64_json: '/9j/2Q==' }] })
  for (let index = 0; index < 11; index++) {
    const generated = await POST(request(brief))
    expect(generated.status).toBe(200)
    const { image } = await generated.json()
    const revised = await POST(
      request({
        ...brief,
        approved: false,
        previous: image,
        revision: 'Bigger text',
      }),
    )
    expect(revised.status).toBe(200)
    expect(await revised.json()).not.toHaveProperty('remaining')
  }
  expect(mocks.generate).toHaveBeenCalledTimes(11)
  expect(mocks.edit).toHaveBeenCalledTimes(11)
  expect(mocks.database).not.toHaveBeenCalled()
})
