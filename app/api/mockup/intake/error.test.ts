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
