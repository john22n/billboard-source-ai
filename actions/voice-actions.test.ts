import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep' }),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test-key' } },
}))

import { chatCompletion } from './voice-actions'

afterEach(() => vi.unstubAllGlobals())

it('keeps accepting system instructions in chat history across SDK upgrades', async () => {
  let sent: Request | undefined
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init)
      return Response.json({
        id: 'resp_test',
        created_at: 1,
        model: 'gpt-4o-mini',
        output: [
          {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Hello, Mara.', annotations: [] },
            ],
          },
        ],
        usage: { input_tokens: 30, output_tokens: 4 },
      })
    },
  )

  expect(
    await chatCompletion([
      { role: 'system', content: 'Greet the user by name.' },
      { role: 'user', content: 'My name is Mara.' },
    ]),
  ).toEqual({ success: true, response: 'Hello, Mara.' })
  expect(sent?.url).toBe('https://api.openai.com/v1/responses')
  expect(await sent?.json()).toMatchObject({
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: 'Greet the user by name.' },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'My name is Mara.' }],
      },
    ],
  })
})
