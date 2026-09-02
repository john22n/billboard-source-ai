import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, rateLimit } = vi.hoisted(() => ({
  getSession: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit }))
vi.mock('@/lib/twilio-client-telemetry', async () =>
  vi.importActual('../../../../lib/twilio-client-telemetry'),
)

import { POST } from './route'

function createRequest(body: unknown) {
  return new Request('http://localhost/api/twilio/client-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createMalformedRequest() {
  return new Request('http://localhost/api/twilio/client-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  })
}

const validEvent = {
  event: 'call-accept-start',
  occurredAt: '2026-09-02T15:05:30.000Z',
  tabId: 'tab-123',
  device: {
    state: 'registered',
    isBusy: false,
    edge: 'ashburn',
    callCount: 1,
    calls: [{ sid: 'CA123', direction: 'INCOMING', status: 'pending' }],
  },
  call: { sid: 'CA123', direction: 'INCOMING', status: 'pending' },
}

describe('POST /api/twilio/client-events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({ userId: 'user-1' })
    rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  })

  it('writes bounded authenticated client diagnostics to server logs', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const response = await POST(createRequest(validEvent))

    expect(response.status).toBe(204)
    expect(rateLimit).toHaveBeenCalledWith(
      'twilio-client-events',
      'user-1',
      120,
      60,
    )
    expect(log).toHaveBeenCalledWith('Twilio client telemetry', {
      userId: 'user-1',
      ...validEvent,
    })
  })

  it('rejects unauthenticated telemetry', async () => {
    getSession.mockResolvedValue(null)

    const response = await POST(createRequest(validEvent))

    expect(response.status).toBe(401)
  })

  it('rejects events outside the telemetry contract', async () => {
    const response = await POST(
      createRequest({ ...validEvent, event: 'arbitrary-client-log' }),
    )

    expect(response.status).toBe(400)
  })

  it('rejects malformed JSON', async () => {
    const response = await POST(createMalformedRequest())

    expect(response.status).toBe(400)
  })
})
