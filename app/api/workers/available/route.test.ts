import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, twilioClient } = vi.hoisted(() => ({
  getSession: vi.fn(),
  twilioClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSessionWithoutRefresh: getSession }))
vi.mock('@/db', () => ({ db: {} }))
vi.mock('twilio', () => ({ default: twilioClient }))
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  return {
    ...actual,
    serverConfig: actual.createServerConfig({
      TWILIO_ACCOUNT_SID: 'AC-test',
      TWILIO_AUTH_TOKEN: 'test-token',
      TASKROUTER_WORKSPACE_SID: 'WS-test',
      TASKROUTER_ACTIVITY_AVAILABLE_SID: 'WA-available',
      // Reproduce the missing Busy activity without contacting Twilio.
    }),
  }
})

import { GET } from './route'

describe('GET /api/workers/available without Busy activity configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
    getSession.mockResolvedValue({ userId: 'rep-1' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns an empty uncached roster without logging on repeated local polls', async () => {
    for (let poll = 0; poll < 2; poll++) {
      const response = await GET()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual({ workers: [] })
    }
    expect(console.error).not.toHaveBeenCalled()
    expect(twilioClient).not.toHaveBeenCalled()
  })

  it('keeps missing configuration visible in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'Worker availability is unavailable',
    })
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('TASKROUTER_ACTIVITY_BUSY_SID'),
    )
  })

  it('still requires authentication locally', async () => {
    getSession.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('does not silence unrelated local failures', async () => {
    const failure = new Error('Session lookup failed')
    getSession.mockRejectedValue(failure)
    const response = await GET()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal error' })
    expect(console.error).toHaveBeenCalledWith(expect.any(String), failure)
  })
})
