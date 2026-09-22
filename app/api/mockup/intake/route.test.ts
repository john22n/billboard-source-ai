import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { freshIntake } from '@/lib/mockup/intake'

vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', sessionStartedAt: 123 }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test' } },
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true }),
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
  generated = { summary, brandNotes: 'Name only' }
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
  expect(log).toHaveBeenCalledWith('Mockup brief preparation failed', {
    errorType: 'AI_APICallError',
  })
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-test-key')
  expect(await response.json()).toEqual({
    error:
      'Could not prepare the mockup brief. Your answers are preserved; please try again.',
  })
})
