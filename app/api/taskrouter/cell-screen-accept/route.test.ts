import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ valid: vi.fn() }))

vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))

import { POST } from './route'

function request(digit: string) {
  return new Request('https://app.example/api/taskrouter/cell-screen-accept', {
    method: 'POST',
    body: new URLSearchParams({
      Digits: digit,
      CallSid: 'CAcell12345678',
      ParentCallSid: 'CAparent12345678',
    }),
  })
}

describe('cell screening acceptance', () => {
  beforeEach(() => mocks.valid.mockResolvedValue(true))

  it('completes screening when the rep presses 1', async () => {
    const response = await POST(request('1'))
    expect(await response.text()).toContain('<Say>Connecting.</Say>')
  })

  it('hangs up the child leg for another digit', async () => {
    const response = await POST(request('2'))
    expect(await response.text()).toContain('<Hangup/>')
  })
})
