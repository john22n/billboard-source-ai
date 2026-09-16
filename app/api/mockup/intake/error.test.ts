import { afterEach, expect, it, vi } from 'vitest'
import { freshIntake } from '@/lib/mockup/intake'

vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', sessionStartedAt: 123 }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test-only' } },
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true }),
}))
import { POST } from './route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('records real SDK failure metadata without leaking provider messages, credentials, or answers', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(
      {
        error: {
          message:
            'Sensitive provider message: sk-private-key and private advertiser data',
          code: 'model_not_found',
          type: 'invalid_request_error',
          param: 'model',
        },
      },
      { status: 404, headers: { 'x-request-id': 'req_test' } },
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const response = await POST(
    new Request('http://localhost/api/mockup/intake', {
      method: 'POST',
      body: JSON.stringify({
        intake: freshIntake(),
        message: 'Private Advertiser',
      }),
    }),
  )
  expect(response.status).toBe(502)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledWith('Mockup intake failed', {
    stage: 'answer-extraction',
    errorType: 'AI_APICallError',
    statusCode: 404,
    requestId: 'req_test',
    code: 'model_not_found',
    type: 'invalid_request_error',
    param: 'model',
  })
  const output = JSON.stringify([log.mock.calls, await response.json()])
  expect(output).not.toContain('sk-private-key')
  expect(output).not.toContain('Sensitive provider message')
  expect(output).not.toContain('Private Advertiser')
})

function modelResponse(text: string | undefined) {
  return Response.json(
    {
      id: 'resp_test',
      created_at: 1741257730,
      model: 'gpt-5.4-mini',
      output:
        text === undefined
          ? []
          : [
              {
                type: 'message',
                role: 'assistant',
                id: 'msg_test',
                content: [{ type: 'output_text', text, annotations: [] }],
              },
            ],
      usage: { input_tokens: 20, output_tokens: 10 },
    },
    { headers: { 'x-request-id': 'req_object' } },
  )
}

it('requests strict extraction and summary schemas through the real SDK', async () => {
  const answers = {
    advertiser: 'Alpine',
    website: '',
    goal: 'Calls',
    market: 'Denver',
    focus: 'Plumbing',
    required: '555-0100',
    tone: 'Bold',
    boardType: null,
  }
  const summary = {
    headline: 'Denver Plumbing',
    supporting: '',
    contact: '555-0100',
    direction: 'Bold',
    caution: '',
  }
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(modelResponse(JSON.stringify(answers)))
    .mockResolvedValueOnce(
      modelResponse(JSON.stringify({ summary, brandNotes: '' })),
    )
  vi.stubGlobal('fetch', fetch)
  const response = await POST(
    new Request('http://localhost/api/mockup/intake', {
      method: 'POST',
      body: JSON.stringify({
        intake: { ...freshIntake(), boardType: 'Digital' },
        message:
          'Alpine plumbing, Denver, calls, bold, 555-0100. Skip website.',
      }),
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    intake: { ...answers, boardType: 'Digital' },
    summary,
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0][1]!.body).toContain(
    'What is the advertiser’s name?',
  )
  for (const [, init] of fetch.mock.calls) {
    const body = JSON.parse(init!.body as string)
    expect(body.text.format.strict).toBe(true)
    expect(body.text.format.schema.required.sort()).toEqual(
      Object.keys(body.text.format.schema.properties).sort(),
    )
  }
})

it.each([
  ['invalid JSON', 'private invalid JSON', 'AI_JSONParseError'],
  [
    'schema mismatch',
    '{"advertiser":"private advertiser"}',
    'AI_TypeValidationError',
  ],
  ['missing text', undefined, undefined],
])(
  'distinguishes %s without logging generated text',
  async (_, text, causeType) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => modelResponse(text)),
    )
    const response = await POST(
      new Request('http://localhost/api/mockup/intake', {
        method: 'POST',
        body: JSON.stringify({
          intake: freshIntake(),
          message: 'private advertiser',
        }),
      }),
    )
    expect(response.status).toBe(502)
    expect(log).toHaveBeenCalledWith(
      'Mockup intake failed',
      expect.objectContaining({
        stage: 'answer-extraction',
        errorType: 'AI_NoObjectGeneratedError',
        causeType,
        hasText: text !== undefined,
        finishReason: 'stop',
        requestId: 'req_object',
      }),
    )
    expect(
      JSON.stringify([log.mock.calls, await response.json()]),
    ).not.toContain('private')
  },
)
