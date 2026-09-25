import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { SignJWT } from 'jose'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type TextStreamPart,
  type ToolSet,
  type UIMessageStreamOptions,
} from 'ai'
import { defaultSystemPrompt } from '@/lib/mockup/system-prompt'
import { toolInstructions } from '@/lib/mockup/instructions'
import {
  readWizardReply,
  replyText,
  type WizardReply,
} from '@/lib/mockup/stream'

const secret = 'test-secret-that-is-long-enough-for-hs256-signing'
const session = { userId: 'rep', sessionStartedAt: 123, email: 'rep@x.test' }
const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
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
  streamText: mocks.streamText,
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (id: string) => ({ modelId: id }),
}))
import { POST } from './route'

type Tools = Record<string, { execute: (input: unknown) => Promise<unknown> }>
type Options = {
  tools: Tools
  system: string
  messages: Array<{
    role: string
    content: Array<{ type: string; text?: string }>
  }>
}

/**
 * Stands in for streamText: runs the scripted turn (tool calls included) while
 * the response streams, then emits the text and the route's finish metadata as
 * a genuine AI SDK UI message stream.
 */
const streams =
  (run: (options: Options) => Promise<string>) => (options: Options) => ({
    toUIMessageStreamResponse: (
      init: UIMessageStreamOptions<WizardReply> & { headers?: HeadersInit },
    ) =>
      createUIMessageStreamResponse({
        headers: init.headers,
        stream: createUIMessageStream<WizardReply>({
          execute: async ({ writer }) => {
            writer.write({ type: 'start' })
            const text = await run(options)
            writer.write({ type: 'text-start', id: 't' })
            writer.write({ type: 'text-delta', id: 't', delta: text })
            writer.write({ type: 'text-end', id: 't' })
            writer.write({
              type: 'finish',
              messageMetadata: init.messageMetadata?.({
                part: { type: 'finish' } as TextStreamPart<ToolSet>,
              }),
            })
          },
        }),
      }),
  })
const replies = (text: string) => streams(async () => text)

/** Reads a streamed turn the way the Creative Studio client does. */
async function readTurn(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const message = await readWizardReply(response.body!)
  return {
    reply: replyText(message).trim(),
    image: message?.metadata?.image ?? null,
    brand: message?.metadata?.brand ?? null,
  }
}
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
  expect(mocks.streamText).not.toHaveBeenCalled()
})

it('sends the editable prompt plus the protected tool frame and returns the reply', async () => {
  mocks.streamText.mockImplementationOnce(
    replies(' What is the advertiser’s name? '),
  )
  const response = await POST(
    request({
      messages: [
        { role: 'assistant', text: 'Earlier question' },
        { role: 'user', text: 'Start' },
      ],
    }),
  )
  expect(await readTurn(response)).toEqual({
    reply: 'What is the advertiser’s name?',
    image: null,
    brand: null,
  })
  const options = mocks.streamText.mock.calls[0][0]
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
  mocks.streamText.mockImplementationOnce(
    streams(async ({ tools }) => {
      const result = await tools.review_website.execute({
        url: 'https://alpine.example',
      })
      expect(result).toEqual({
        website: 'https://alpine.example',
        logoCaptured: true,
        note: '',
        evidence: 'Alpine Dental. Theme color: #123456',
      })
      return 'Thanks. What is the goal?'
    }),
  )
  const data = await readTurn(
    await POST(
      request({ messages: [{ role: 'user', text: 'alpine.example' }] }),
    ),
  )
  expect(data.brand).toMatchObject({
    website: 'https://alpine.example',
    logo: png,
  })
  expect(typeof data.brand?.receipt).toBe('string')
  expect(JSON.stringify(mocks.streamText.mock.calls[0][0])).not.toContain(png)

  // The signed logo is accepted as the first reference on a later turn.
  mocks.streamText.mockImplementationOnce(
    streams(async ({ tools }) => {
      await tools.generate_billboard.execute({
        advertiser: 'Alpine Dental',
        prompt: 'Headline "Smile Bigger"',
        revision: false,
      })
      return 'Here it is.'
    }),
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
  expect(mocks.streamText).not.toHaveBeenCalled()
})

it('renders a new billboard with uploads as references and signs the result', async () => {
  const attachment = {
    id: 'a1',
    name: 'logo.png',
    sourceType: 'image/png',
    dataUrl: png,
  }
  mocks.streamText.mockImplementationOnce(
    streams(async ({ tools, messages }) => {
      expect(messages.at(-1)?.content[1].text).toContain('logo.png')
      expect(messages.at(-1)?.content[2].type).toBe('image')
      const result = await tools.generate_billboard.execute({
        advertiser: '  Alpine Dental ',
        prompt: 'Headline "Smile Bigger" in navy',
        revision: false,
      })
      expect(result).toMatchObject({ ok: true })
      return ''
    }),
  )
  const response = await POST(
    request({
      messages: [{ role: 'user', text: 'Professional' }],
      attachments: [attachment],
    }),
  )
  const data = await readTurn(response)
  expect(mocks.render).toHaveBeenCalledWith(
    expect.stringContaining('do NOT invent a logo'),
    [png],
  )
  expect(mocks.render.mock.calls[0][0]).toContain('["logo.png"]')
  expect(data.image).toMatchObject({
    advertiser: 'Alpine Dental',
    dataUrl: jpeg,
  })
  expect(data.image?.id).toMatch(/^[0-9a-f-]{36}$/)
  // An image with no words: the client supplies the ready message.
  expect(data.reply).toBe('')
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
  mocks.streamText.mockImplementationOnce(
    streams(async ({ tools }) => {
      await tools.generate_billboard.execute({
        advertiser: 'Renamed by the model',
        prompt: 'Make the headline larger',
        revision: true,
      })
      return 'Done.'
    }),
  )
  const data = await readTurn(
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
    ),
  )
  expect(mocks.render).toHaveBeenCalledWith(
    expect.stringMatching(/^Edit the supplied CURRENT selected/),
    [jpeg],
  )
  expect(data.image).toMatchObject({
    advertiser: 'Alpine',
    dataUrl: 'data:image/jpeg;base64,/9j/AA==',
  })
  expect(data.image?.id).not.toBe(id)
})

it('reports rendering failures to the model instead of failing the turn', async () => {
  mocks.render.mockRejectedValueOnce(new Error('provider down'))
  mocks.streamText.mockImplementationOnce(
    streams(async ({ tools }) => {
      const result = await tools.generate_billboard.execute({
        advertiser: 'Alpine',
        prompt: 'x',
        revision: false,
      })
      expect(result).toMatchObject({ ok: false })
      return 'The image failed; shall I retry?'
    }),
  )
  const response = await POST(
    request({ messages: [{ role: 'user', text: 'Generate' }] }),
  )
  expect(await readTurn(response)).toEqual({
    reply: 'The image failed; shall I retry?',
    image: null,
    brand: null,
  })
})

it('reports a model failure inside the stream without leaking details', async () => {
  mocks.streamText.mockImplementationOnce(() => ({
    toUIMessageStreamResponse: (
      init: UIMessageStreamOptions<WizardReply> & { headers?: HeadersInit },
    ) =>
      createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: 'start' })
            writer.write({
              type: 'error',
              errorText: init.onError!(new Error('secret provider detail')),
            })
          },
        }),
      }),
  }))
  const response = await POST(
    request({ messages: [{ role: 'user', text: 'Start' }] }),
  )
  expect(response.status).toBe(200)
  const body = await response.text()
  expect(body).toContain('selected image are unchanged')
  expect(body).not.toContain('secret provider detail')
})

it('returns a retryable error when the wizard cannot be prepared', async () => {
  mocks.streamText.mockImplementationOnce(() => {
    throw new Error('misconfigured')
  })
  const response = await POST(
    request({ messages: [{ role: 'user', text: 'Start' }] }),
  )
  expect(response.status).toBe(502)
  expect((await response.json()).error).toContain(
    'selected image are unchanged',
  )
})
