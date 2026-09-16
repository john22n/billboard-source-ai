import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  listCalls: vi.fn(),
  updateCall: vi.fn(),
}))

vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'ACtest',
        authToken: 'test',
      }),
    },
  },
}))
vi.mock('twilio', () => ({
  default: () => ({
    calls: Object.assign(() => ({ update: mocks.updateCall }), {
      list: mocks.listCalls,
    }),
  }),
}))

import { POST } from './route'

function request(status: string) {
  // Include the legacy cellPhone parameter: callbacks from calls already in
  // progress at deployment must also leave the cell leg alone.
  return new Request(
    'https://app.example/api/taskrouter/client-status?leg=browser&taskSid=WTtask&cellPhone=%2B13035550123',
    {
      method: 'POST',
      body: new URLSearchParams({
        CallStatus: status,
        CallSid: 'CAbrowser',
        ParentCallSid: 'CAcaller',
      }),
    },
  )
}

describe('simultaneous dial browser status callbacks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.valid.mockResolvedValue(true)
    mocks.listCalls.mockResolvedValue([{ sid: 'CAcell' }])
    mocks.updateCall.mockResolvedValue({})
  })

  it.each(['busy', 'canceled', 'no-answer'])(
    'acknowledges %s without finding or canceling the cell leg',
    async (status) => {
      const response = await POST(request(status))

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      expect(mocks.listCalls).not.toHaveBeenCalled()
      expect(mocks.updateCall).not.toHaveBeenCalled()
    },
  )
})
