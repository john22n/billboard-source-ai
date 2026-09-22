import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', email: 'rep@example.test' }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { nutshell: { requireApiKey: () => 'test-only' } },
}))
vi.mock('@/lib/mockup/receipts', () => ({ verifyImage: vi.fn() }))

import { GET, POST } from './route'

afterEach(() => vi.unstubAllGlobals())

it.each(['GET', 'POST'])(
  'retires existing-lead %s without contacting Nutshell',
  async (method) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: {} }))
    vi.stubGlobal('fetch', fetcher)
    const response = await (method === 'GET' ? GET : POST)()
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error:
        'Mockups can only be sent when creating a new Nutshell lead through the Lead Form.',
    })
    expect(fetcher).not.toHaveBeenCalled()
  },
)
