import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  record: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
  config: {
    overflowNumber: '+15551234567' as string | null,
    mainNumber: '+15557654321',
    requireAccountCredentials: () => ({
      accountSid: 'ACtest',
      authToken: 'test',
    }),
  },
}))

vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock('@/lib/call-attempt-outcomes', () => ({
  recordOverflowAttempt: mocks.record,
}))
vi.mock(
  '@/lib/voice-agent-routing',
  () => import('../../../../lib/voice-agent-routing'),
)
vi.mock('@/lib/config', () => ({ serverConfig: { twilio: mocks.config } }))
vi.mock('twilio', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('twilio') }>()
  const client = Object.assign(
    () => ({
      taskrouter: {
        v1: {
          workspaces: () => ({
            tasks: () => ({
              fetch: mocks.fetch,
              update: mocks.update,
            }),
          }),
        },
      },
    }),
    { twiml: actual.default.twiml },
  )
  return { default: client }
})

import { POST } from './route'

const request = () =>
  new Request(
    'https://app.example/api/taskrouter/overflow?taskSid=WT123&workspaceSid=WS123&callerFrom=%2B15559876543',
    { method: 'POST' },
  )

describe('terminal overflow routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.valid.mockResolvedValue(true)
    mocks.fetch.mockResolvedValue({
      assignmentStatus: 'assigned',
      attributes: '{"call_sid":"CA123"}',
    })
    mocks.update.mockResolvedValue({})
    mocks.config.overflowNumber = '+15551234567'
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['2026-09-12T13:59:59Z', false], // Saturday CDT 08:59:59
    ['2026-09-12T14:00:00Z', true],
    ['2026-09-12T17:59:59Z', true],
    ['2026-09-12T18:00:00Z', false],
    ['2026-09-13T14:00:00Z', true], // Sunday
    ['2026-09-11T15:00:00Z', false], // Friday
    ['2026-09-14T15:00:00Z', false], // Monday
    ['2026-01-10T14:59:59Z', false], // Saturday CST
    ['2026-01-10T15:00:00Z', true],
    ['2026-01-11T18:59:59Z', true],
    ['2026-01-11T19:00:00Z', false],
    ['2026-03-08T14:00:00Z', true], // DST begins
    ['2026-11-01T15:00:00Z', true], // DST ends
  ])('routes at %s (voice agent: %s)', async (time, voiceAgent) => {
    vi.setSystemTime(new Date(time))
    const response = await POST(request())
    const xml = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/xml')
    expect(mocks.update).toHaveBeenCalledWith({
      assignmentStatus: 'completed',
      reason: voiceAgent
        ? 'Routed to voicemail AI agent'
        : 'Routed to overflow number',
    })
    if (voiceAgent) {
      expect(xml).toContain(
        '<Redirect method="POST">https://voicemail-agent.john22n-iii.com/</Redirect>',
      )
      expect(xml).not.toContain('<Dial')
      expect(xml).toContain('<Recording channels="dual" track="both"')
      expect(mocks.record).not.toHaveBeenCalled()
    } else {
      expect(xml).toContain('<Dial callerId="+15559876543">+15551234567</Dial>')
      expect(xml).not.toContain('<Redirect')
      expect(xml).not.toContain('<Recording')
      expect(mocks.record).toHaveBeenCalledWith({
        callSid: 'CA123',
        taskSid: 'WT123',
      })
    }
  })

  it('can redirect without an overflow number even if task cleanup fails', async () => {
    vi.setSystemTime(new Date('2026-09-13T16:00:00Z'))
    mocks.config.overflowNumber = null
    mocks.fetch.mockRejectedValue(new Error('Twilio unavailable'))
    expect(await (await POST(request())).text()).toContain(
      '<Redirect method="POST">',
    )
  })

  it('rejects unauthenticated requests before routing or side effects', async () => {
    mocks.valid.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
