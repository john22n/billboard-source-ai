import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ valid: vi.fn() }))

vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    app: {
      baseUrlFromRequest: () => 'https://app.example',
      addVercelBypassToken: vi.fn(),
    },
  },
}))

import { POST } from './route'

function request() {
  return new Request(
    'https://app.example/api/taskrouter/cell-screen?taskSid=WTtask',
    {
      method: 'POST',
      body: new URLSearchParams({
        CallSid: 'CAcell12345678',
        ParentCallSid: 'CAparent12345678',
      }),
    },
  )
}

describe('cell screening', () => {
  beforeEach(() => mocks.valid.mockResolvedValue(true))

  it('uses a short prompt and five-second input timeout', async () => {
    const response = await POST(request())
    const xml = await response.text()

    expect(response.status).toBe(200)
    expect(xml).toContain('timeout="5"')
    expect(xml).toContain('Sales call. Press 1.')
    expect(xml).toContain('/api/taskrouter/cell-screen-accept')
  })

  it('rejects unsigned requests', async () => {
    mocks.valid.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(403)
  })
})
