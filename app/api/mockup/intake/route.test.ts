import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { freshIntake, intakeSchema, nextQuestion } from '@/lib/mockup/intake'

vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', sessionStartedAt: 123 }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test' } },
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true }),
}))
vi.mock('@/lib/mockup/website', () => ({
  reviewWebsite: async () => ({
    text: 'Website colors: #123456 and #fedc98. Georgia headings.',
    logo: null,
    fallback: '',
  }),
}))
import { POST } from './route'

const fetcher = vi.fn<typeof fetch>()
let generated: Record<string, unknown>

function providerResponse(value: unknown) {
  return Response.json({
    id: 'resp_test',
    created_at: 1790112545,
    model: 'gpt-5.4-mini',
    output: [
      {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'output_text', text: JSON.stringify(value), annotations: [] },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  generated = { ...freshIntake(), tone: 'Bold', boardType: null }
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockImplementation(async (_url, init) => {
    const { schema, strict } = JSON.parse(String(init?.body)).text.format
    if (
      strict &&
      !Object.keys(schema.properties).every((key) =>
        schema.required.includes(key),
      )
    )
      return Response.json(
        {
          error: {
            message: 'Every schema property must be required',
            type: 'invalid_request_error',
            code: 'invalid_json_schema',
          },
        },
        { status: 400 },
      )
    const output = { ...generated }
    // Captured failure: non-strict output omitted the mandatory copy field despite HTTP 200.
    if (!strict) delete output.required
    return providerResponse(output)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function request(body: unknown) {
  return new Request('http://localhost/api/mockup/intake', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

it('rejects remote attachment URLs before reading any file or calling the provider', async () => {
  const response = await POST(
    request({
      intake: freshIntake(),
      message: 'Use my logo',
      attachments: [
        {
          id: 'remote',
          name: 'logo.png',
          sourceType: 'image/png',
          dataUrl: 'https://internal.example/logo.png',
        },
      ],
    }),
  )
  expect(response.status).toBe(400)
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([
  'website and website content',
  'website',
  'Paid for by Example PAC',
  'x'.repeat(4000),
])(
  'preserves required-copy answers without re-extracting advertiser facts (%s)',
  async (message) => {
    const intake = {
      ...freshIntake(),
      advertiser: 'Example AI',
      website: 'https://example.com',
      goal: 'Awareness',
      market: 'Denver',
      focus: 'AI Integration',
    }
    // Reproduce the provider misclassifying the reply and dropping required copy.
    generated = { ...freshIntake(), website: 'website', boardType: null }
    const response = await POST(request({ intake, message }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.intake).toEqual({ ...intake, required: message })
    expect(intakeSchema.safeParse(body.intake).success).toBe(true)
    expect(nextQuestion(body.intake)).toBe('tone')
    expect(fetcher).not.toHaveBeenCalled()
  },
)

it.each([
  { message: 'skip', required: '', next: 'tone' },
  { message: '   ', required: null, next: 'required' },
])(
  'handles empty and skipped required-copy answers ($message)',
  async ({ message, required, next }) => {
    const intake = {
      ...freshIntake(),
      advertiser: 'Example AI',
      website: '',
      goal: 'Awareness',
      market: 'Denver',
      focus: 'AI Integration',
    }
    const response = await POST(request({ intake, message }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.intake).toEqual({ ...intake, required })
    expect(nextQuestion(body.intake)).toBe(next)
    expect(fetcher).not.toHaveBeenCalled()
  },
)

it.each([null, 'Static'])(
  'enforces complete output and preserves Digital unless board type is explicitly answered (%s)',
  async (boardType) => {
    generated.boardType = boardType
    const response = await POST(
      request({
        intake: {
          ...freshIntake(),
          advertiser: 'Alpine',
          boardType: 'Digital',
        },
        message: 'Make it bold.',
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      intake: {
        advertiser: 'Alpine',
        required: null,
        boardType: boardType ?? 'Digital',
        tone: 'Bold',
      },
    })
    const format = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text
      .format
    expect(format.strict).toBe(true)
    expect(format.schema.required).toEqual(
      Object.keys(format.schema.properties),
    )
  },
)

it('also enforces strict output for the approval summary', async () => {
  const summary = {
    headline: 'Smile bigger',
    supporting: '',
    contact: '',
    direction: 'Bold',
    caution: '',
  }
  generated = { summary, brandNotes: 'Name only', omitWebsite: false }
  const response = await POST(
    request({
      intake: { ...freshIntake(), advertiser: 'Alpine', website: '' },
      review: true,
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    summary,
    brand: { logo: null },
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  const format = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text.format
  expect(format.strict).toBe(true)
})

it('sends uploaded PDF page imagery and its use instructions to brief preparation', async () => {
  generated = {
    summary: {
      headline: 'Alpine',
      supporting: '',
      contact: '',
      direction: 'Use the supplied mountain background.',
      caution: '',
    },
    brandNotes: 'User supplied a background.',
    omitWebsite: false,
  }
  const dataUrl = 'data:image/jpeg;base64,/9j/2Q=='
  const response = await POST(
    request({
      intake: { ...freshIntake(), advertiser: 'Alpine' },
      review: true,
      attachmentInstructions: 'Render the billboard on this PDF background.',
      attachments: [
        {
          id: 'pdf-1',
          name: 'mountain.pdf',
          sourceType: 'application/pdf',
          dataUrl,
        },
      ],
    }),
  )
  expect(response.status).toBe(200)
  const input = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).input
  expect(JSON.stringify(input)).toContain(
    'Render the billboard on this PDF background.',
  )
  expect(JSON.stringify(input)).toContain('PDF page 1 only')
  expect(
    input.flatMap((message: { content: unknown[] }) => message.content),
  ).toContainEqual(
    expect.objectContaining({ type: 'input_image', image_url: dataUrl }),
  )
})

it.each([false, true])(
  'includes website contact by default unless explicitly omitted (%s)',
  async (omitWebsite) => {
    generated = {
      summary: {
        headline: 'Alpine',
        supporting: '',
        contact: '555-0123',
        direction: 'Navy #123456 with gold #fedc98 accents',
        caution: '',
      },
      brandNotes: 'Georgia headings.',
      omitWebsite,
    }
    const response = await POST(
      request({
        intake: {
          ...freshIntake(),
          advertiser: 'Alpine',
          website: 'https://alpine.example/',
        },
        review: true,
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      summary: {
        contact: omitWebsite ? '555-0123' : '555-0123 · alpine.example',
      },
    })
  },
)

it('logs the failure type without exposing provider credentials or advertiser content', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  fetcher.mockResolvedValueOnce(
    Response.json(
      {
        error: {
          message:
            'Incorrect API key: private-test-key; confidential advertiser',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      { status: 401 },
    ),
  )
  const response = await POST(
    request({ intake: freshIntake(), message: 'Confidential advertiser' }),
  )
  expect(response.status).toBe(502)
  expect(log).toHaveBeenCalledWith(
    'Mockup intake failed',
    expect.objectContaining({
      stage: 'answer-extraction',
      errorType: 'AI_APICallError',
      code: 'invalid_api_key',
    }),
  )
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-test-key')
  expect(await response.json()).toEqual({
    error:
      'Could not prepare the mockup brief. Your answers are preserved; please try again.',
  })
})
