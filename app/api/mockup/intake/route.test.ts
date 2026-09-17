import { expect, it, vi } from 'vitest'
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
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => 'test-model' }))
vi.mock('ai', () => ({
  generateObject: async ({
    schema,
  }: {
    schema: { parse: (value: unknown) => unknown }
  }) => ({
    object: schema.parse({
      advertiser: null,
      website: null,
      goal: null,
      market: null,
      focus: null,
      required: null,
      tone: 'Bold',
      boardType: null,
    }),
  }),
}))
import { POST } from './route'

it('preserves a requested digital board when an unrelated answer omits board type', async () => {
  const response = await POST(
    new Request('http://localhost/api/mockup/intake', {
      method: 'POST',
      body: JSON.stringify({
        intake: {
          ...freshIntake(),
          advertiser: 'Alpine',
          boardType: 'Digital',
        },
        message: 'Make it bold.',
      }),
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    intake: { advertiser: 'Alpine', boardType: 'Digital', tone: 'Bold' },
  })
})
