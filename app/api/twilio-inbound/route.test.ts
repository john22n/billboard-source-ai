import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  count: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  workflow: vi.fn(),
}))

vi.mock('@/db', () => ({ db: { select: mocks.select } }))
vi.mock('@/db/schema', () => ({ user: { twilioPhoneNumber: 'phone' } }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/dal', () => ({ incrementMainCallsTotal: mocks.count }))
vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock(
  '@/lib/voice-agent-routing',
  () => import('../../../lib/voice-agent-routing'),
)
vi.mock('@/lib/config', () => ({
  isMissingConfig: () => false,
  configErrorResponseBody: vi.fn(),
  serverConfig: {
    runtime: { isProductionDeployment: true },
    twilio: { mainNumber: '+15551111111' },
    taskRouter: { requireWorkflowSid: mocks.workflow },
    app: {
      baseUrlFromRequest: () => 'https://app.example',
      addVercelBypassToken: vi.fn(),
    },
  },
}))

import { POST } from './route'

const request = (to: string) =>
  new Request('https://app.example/api/twilio-inbound', {
    method: 'POST',
    body: new URLSearchParams({
      CallSid: 'CA123',
      From: '+15553333333',
      To: to,
    }),
  })

describe('inbound weekend AI coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.valid.mockResolvedValue(true)
    mocks.workflow.mockReturnValue('WW123')
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: mocks.limit }) }),
    })
    mocks.limit.mockResolvedValue([{ email: 'rep@example.com' }])
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['2026-09-12T11:00:00Z', '+15551111111'], // Saturday 6am CDT, main
    ['2026-09-13T02:59:59Z', '+15552222222'], // Saturday before 10pm CDT, direct
    ['2026-09-13T11:00:00Z', '+15552222222'], // Sunday 6am CDT
    ['2026-09-14T02:59:59Z', '+15551111111'], // Sunday before 10pm CDT (Monday UTC)
    ['2026-01-11T12:00:00Z', '+15551111111'], // Sunday 6am CST
    ['2026-01-12T03:59:59Z', '+15552222222'], // Sunday before 10pm CST
  ])('bypasses reps and TaskRouter at %s for %s', async (time, to) => {
    vi.setSystemTime(new Date(time))
    mocks.workflow.mockImplementation(() => {
      throw new Error('TaskRouter unavailable')
    })
    mocks.select.mockImplementation(() => {
      throw new Error('Rep database unavailable')
    })
    const response = await POST(request(to))
    const xml = await response.text()
    expect(response.status).toBe(200)
    expect(xml).toContain(
      '<Redirect method="POST">https://voicemail-agent.john22n-iii.com/</Redirect>',
    )
    expect(xml).not.toMatch(/<Enqueue|<Dial/)
    expect(xml).toContain('<Recording channels="dual" track="both"')
    expect(xml).toContain(
      'recordingStatusCallback="https://app.example/api/twilio/voicemail-ai-recording#rc=3&amp;rp=ct,rt,5xx"',
    )
    expect(xml.indexOf('<Say>')).toBeLessThan(xml.indexOf('<Start>'))
    expect(xml.indexOf('<Start>')).toBeLessThan(xml.indexOf('<Redirect'))
    expect(mocks.workflow).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.count).toHaveBeenCalledTimes(to === '+15551111111' ? 1 : 0)
  })

  it.each([
    ['2026-09-12T10:59:59Z', '+15551111111', 'main'], // Saturday before 6am CDT
    ['2026-09-13T03:00:00Z', '+15552222222', 'direct'], // Saturday 10pm CDT
    ['2026-09-13T10:59:59Z', '+15552222222', 'direct'], // Sunday before 6am CDT
    ['2026-09-14T03:00:00Z', '+15551111111', 'main'], // Sunday 10pm CDT
    ['2026-01-11T11:59:59Z', '+15551111111', 'main'], // Sunday before 6am CST
    ['2026-01-12T04:00:00Z', '+15552222222', 'direct'], // Sunday 10pm CST
    ['2026-09-14T15:00:00Z', '+15552222222', 'direct'],
  ])('keeps normal routing at %s for %s', async (time, to, callType) => {
    vi.setSystemTime(new Date(time))
    const xml = await (await POST(request(to))).text()
    expect(xml).toContain('<Enqueue workflowSid="WW123"')
    expect(xml).toContain(`"callType":"${callType}"`)
    expect(xml).not.toContain('<Redirect')
    expect(xml).not.toContain('<Recording')
    expect(mocks.select).toHaveBeenCalledTimes(callType === 'direct' ? 1 : 0)
    expect(mocks.count).toHaveBeenCalledTimes(callType === 'main' ? 1 : 0)
  })

  it('rejects unsigned calls before redirecting or counting', async () => {
    vi.setSystemTime(new Date('2026-09-12T15:00:00Z'))
    mocks.valid.mockResolvedValue(false)
    expect((await POST(request('+15551111111'))).status).toBe(403)
    expect(mocks.count).not.toHaveBeenCalled()
    expect(mocks.workflow).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
