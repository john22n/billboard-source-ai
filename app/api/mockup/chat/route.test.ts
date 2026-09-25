import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { SignJWT } from 'jose'
import { defaultSystemPrompt } from '@/lib/mockup/system-prompt'
import { toolInstructions } from '@/lib/mockup/instructions'

const secret = 'test-secret-that-is-long-enough-for-hs256-signing'
const session = { userId: 'rep', sessionStartedAt: 123, email: 'rep@x.test' }
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  render: vi.fn(),
  review: vi.fn(),
  rateLimit: vi.fn(),
  session: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    openai: { requireApiKey: () => 'test' },
    auth: { jwtSecret: 'test-secret-that-is-long-enough-for-hs256-signing' },
  },
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))
vi.mock('@/lib/mockup/render', () => ({ renderBillboard: mocks.render }))
vi.mock('@/lib/mockup/website', () => ({ reviewWebsite: mocks.review }))
vi.mock('@/lib/mockup/system-prompt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mockup/system-prompt')>()),
  getSystemPrompt: async () => ({
    prompt: 'Custom wizard prompt',
    isDefault: false,
  }),
}))
vi.mock('@/db', () => ({ db: {} }))
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generateText,
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (id: string) => ({ modelId: id }),
}))
import { POST } from './route'

type Tools = Record<string, { execute: (input: unknown) => Promise<unknown> }>
const request = (body: unknown) =>
  new Request('http://localhost/api/mockup/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  })
const png = `data:image/png;base64,${Buffer.from('\x89PNG\r\n\x1a\nrest', 'latin1').toString('base64')}`
const jpeg = 'data:image/jpeg;base64,/9j/2Q=='
const receipt = (
  kind: 'logo' | 'image',
  data: string,
  advertiser: string,
  id: string,
) =>
  new SignJWT({
    hash: createHash('sha256').update(data).digest('hex'),
    advertiser,
    id,
    session: session.sessionStartedAt,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setAudience(`mockup-${kind}`)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue(session)
  mocks.rateLimit.mockResolvedValue({ allowed: true })
  mocks.render.mockResolvedValue(jpeg)
})

it('requires a signed-in rep, a user message last, and respects the rate limit', async () => {
  mocks.session.mockResolvedValueOnce(null)
  expect((await POST(request({ messages: [] }))).status).toBe(401)
  expect(
    (await POST(request({ messages: [{ role: 'assistant', text: 'Hi' }] })))
      .status,
  ).toBe(400)
  mocks.rateLimit.mockResolvedValueOnce({ allowed: false })
  expect(
    (await POST(request({ messages: [{ role: 'user', text: 'Start' }] })))
      .status,
  ).toBe(429)
  expect(mocks.generateText).not.toHaveBeenCalled()
})

it('sends the editable prompt plus the protected tool frame and returns the reply', async () => {
  mocks.generateText.mockResolvedValueOnce({
    text: ' What is the advertiser’s name? ',
  })
  const response = await POST(
    request({
      messages: [
        { role: 'assistant', text: 'Earlier question' },
        { role: 'user', text: 'Start' },
      ],
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    reply: 'What is the advertiser’s name?',
    image: null,
    brand: null,
  })
  const options = mocks.generateText.mock.calls[0][0]
  expect(options.system).toBe(`Custom wizard prompt\n\n${toolInstructions}`)
  expect(options.system).not.toContain(defaultSystemPrompt.slice(0, 40))
  expect(options.messages).toEqual([
    { role: 'assistant', content: 'Earlier question' },
    { role: 'user', content: [{ type: 'text', text: 'Start' }] },
  ])
  expect(Object.keys(options.tools)).toEqual([
    'review_website',
    'generate_billboard',
  ])
})

it('captures the website logo out of band and signs it for later turns', async () => {
  mocks.review.mockResolvedValueOnce({
    text: 'Alpine Dental. Theme color: #123456',
    logo: png,
    fallback: '',
  })
  mocks.generateText.mockImplementationOnce(
    async ({ tools }: { tools: Tools }) => {
      const result = await tools.review_website.execute({
        url: 'https://alpine.example',
      })
      expect(result).toEqual({
        website: 'https://alpine.example',
        logoCaptured: true,
        note: '',
        evidence: 'Alpine Dental. Theme color: #123456',
      })
      return { text: 'Thanks. What is the goal?' }
    },
  )
  const data = await (
    await POST(
      request({ messages: [{ role: 'user', text: 'alpine.example' }] }),
    )
  ).json()
  expect(data.brand).toMatchObject({
    website: 'https://alpine.example',
    logo: png,
  })
  expect(typeof data.brand.receipt).toBe('string')
  expect(JSON.stringify(mocks.generateText.mock.calls[0][0])).not.toContain(png)

  // The signed logo is accepted as the first reference on a later turn.
  mocks.generateText.mockImplementationOnce(
    async ({ tools }: { tools: Tools }) => {
      await tools.generate_billboard.execute({
        advertiser: 'Alpine Dental',
        prompt: 'Headline "Smile Bigger"',
        revision: false,
      })
      return { text: 'Here it is.' }
    },
  )
  const second = await POST(
    request({
      messages: [{ role: 'user', text: 'Looks good, generate it' }],
      brand: data.brand,
    }),
  )
  expect(second.status).toBe(200)
  expect(mocks.render).toHaveBeenCalledWith(
    expect.stringContaining('website logo; reproduce it faithfully'),
    [png],
  )
  expect(mocks.render.mock.calls[0][0]).toContain(
    'Creative brief: Headline "Smile Bigger"',
  )
})

it('rejects a tampered logo or image receipt before contacting the model', async () => {
  const forged = await receipt('logo', png, '', 'https://other.example')
  const rejected = await POST(
    request({
      messages: [{ role: 'user', text: 'Generate' }],
      brand: { website: 'https://alpine.example', logo: png, receipt: forged },
    }),
  )
  expect(rejected.status).toBe(400)
  const image = {
    id: '11111111-1111-4111-8111-111111111111',
    advertiser: 'Alpine',
    dataUrl: jpeg,
    receipt: await receipt(
      'image',
      jpeg,
      'Alpine',
      '22222222-2222-4222-8222-222222222222',
    ),
  }
  expect(
    (
      await POST(
        request({ messages: [{ role: 'user', text: 'Bigger' }], image }),
      )
    ).status,
  ).toBe(400)
  expect(mocks.generateText).not.toHaveBeenCalled()
})

it('renders a new billboard with uploads as references and signs the result', async () => {
  const attachment = {
    id: 'a1',
    name: 'logo.png',
    sourceType: 'image/png',
    dataUrl: png,
  }
  mocks.generateText.mockImplementationOnce(async ({ tools, messages }) => {
    expect(messages.at(-1).content[1].text).toContain('logo.png')
    expect(messages.at(-1).content[2].type).toBe('image')
    const result = await tools.generate_billboard.execute({
      advertiser: '  Alpine Dental ',
      prompt: 'Headline "Smile Bigger" in navy',
      revision: false,
    })
    expect(result).toMatchObject({ ok: true })
    return { text: '' }
  })
  const response = await POST(
    request({
      messages: [{ role: 'user', text: 'Professional' }],
      attachments: [attachment],
    }),
  )
  const data = await response.json()
  expect(mocks.render).toHaveBeenCalledWith(
    expect.stringContaining('do NOT invent a logo'),
    [png],
  )
  expect(mocks.render.mock.calls[0][0]).toContain('["logo.png"]')
  expect(data.image).toMatchObject({
    advertiser: 'Alpine Dental',
    dataUrl: jpeg,
  })
  expect(data.image.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(data.reply).toContain('Your mockup is ready')
  // The receipt must verify against the same session.
  const followUp = await POST(
    request({
      messages: [{ role: 'user', text: 'Make the text bigger' }],
      image: data.image,
    }),
  )
  expect(followUp.status).not.toBe(400)
})

it('edits the current image for revisions and keeps its advertiser', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const image = {
    id,
    advertiser: 'Alpine',
    dataUrl: jpeg,
    receipt: await receipt('image', jpeg, 'Alpine', id),
  }
  mocks.render.mockResolvedValueOnce('data:image/jpeg;base64,/9j/AA==')
  mocks.generateText.mockImplementationOnce(
    async ({ tools }: { tools: Tools }) => {
      await tools.generate_billboard.execute({
        advertiser: 'Renamed by the model',
        prompt: 'Make the headline larger',
        revision: true,
      })
      return { text: 'Done.' }
    },
  )
  const data = await (
    await POST(
      request({
        messages: [{ role: 'user', text: 'Make the headline larger' }],
        image,
        brand: {
          website: 'alpine.example',
          logo: png,
          receipt: await receipt('logo', png, '', 'alpine.example'),
        },
      }),
    )
  ).json()
  expect(mocks.render).toHaveBeenCalledWith(
    expect.stringMatching(/^Edit the supplied CURRENT selected/),
    [jpeg],
  )
  expect(data.image).toMatchObject({
    advertiser: 'Alpine',
    dataUrl: 'data:image/jpeg;base64,/9j/AA==',
  })
  expect(data.image.id).not.toBe(id)
})

it('reports rendering failures to the model instead of failing the turn', async () => {
  mocks.render.mockRejectedValueOnce(new Error('provider down'))
  mocks.generateText.mockImplementationOnce(
    async ({ tools }: { tools: Tools }) => {
      const result = await tools.generate_billboard.execute({
        advertiser: 'Alpine',
        prompt: 'x',
        revision: false,
      })
      expect(result).toMatchObject({ ok: false })
      return { text: 'The image failed; shall I retry?' }
    },
  )
  const response = await POST(
    request({ messages: [{ role: 'user', text: 'Generate' }] }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    reply: 'The image failed; shall I retry?',
    image: null,
    brand: null,
  })
})

it('returns a retryable error when the model produces nothing', async () => {
  mocks.generateText.mockResolvedValueOnce({ text: '' })
  const response = await POST(
    request({ messages: [{ role: 'user', text: 'Start' }] }),
  )
  expect(response.status).toBe(502)
  expect((await response.json()).error).toContain(
    'selected image are unchanged',
  )
})
