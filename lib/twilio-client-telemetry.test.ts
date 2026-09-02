import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sendTwilioClientTelemetry,
  type TwilioClientTelemetry,
} from './twilio-client-telemetry'

const event: TwilioClientTelemetry = {
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

describe('sendTwilioClientTelemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends structured call state without blocking the call flow', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    sendTwilioClientTelemetry(event)

    expect(fetchMock).toHaveBeenCalledWith('/api/twilio/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    })
  })
})
