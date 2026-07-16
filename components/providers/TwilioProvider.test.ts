import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@twilio/voice-sdk', () => ({
  Call: { Codec: { Opus: 'opus', PCMU: 'pcmu' } },
  Device: class {},
}))

vi.mock('@/hooks/useWorkerStatus', () => ({
  useWorkerStatus: vi.fn(),
}))

import { bindDeviceEvents } from './TwilioProvider'

function setupDeviceEvents() {
  const listeners = new Map<
    string,
    (error?: Error & { code?: number }) => void
  >()
  const device = {
    edge: 'ashburn',
    on: vi.fn(
      (
        event: string,
        listener: (error?: Error & { code?: number }) => void,
      ) => {
        listeners.set(event, listener)
      },
    ),
    register: vi.fn(),
    state: 'registered',
    updateToken: vi.fn(),
  }
  const runtime = {
    acceptingCall: null,
    activeCall: null,
    device,
    initialized: true,
    initializing: false,
    loggedOut: false,
    notification: null,
    onCallAccepted: null,
    onCallDisconnected: null,
    workerStatus: 'available',
  }
  const update = vi.fn()
  const setWorkerStatus = vi.fn().mockResolvedValue(undefined)
  const fetchMock = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      token: 'replacement-token',
      identity: 'rep@billboardsource.com',
    }),
  })
  vi.stubGlobal('fetch', fetchMock)

  bindDeviceEvents(runtime as never, update, device as never, setWorkerStatus)
  return { device, fetchMock, listeners, setWorkerStatus, update }
}

async function expectTokenRefresh(setup: ReturnType<typeof setupDeviceEvents>) {
  await vi.waitFor(() => {
    expect(setup.fetchMock).toHaveBeenCalledWith('/api/twilio-token')
    expect(setup.device.updateToken).toHaveBeenCalledWith('replacement-token')
  })
  expect(setup.setWorkerStatus).not.toHaveBeenCalled()
}

describe('Twilio token lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces an expiring device token without changing worker availability', async () => {
    const setup = setupDeviceEvents()
    setup.listeners.get('tokenWillExpire')?.()
    await expectTokenRefresh(setup)
  })

  it('recovers an invalid access token instead of displaying error 20101', async () => {
    const setup = setupDeviceEvents()
    const tokenError = Object.assign(new Error('AccessTokenInvalid'), {
      code: 20101,
    })

    setup.listeners.get('error')?.(tokenError)

    await expectTokenRefresh(setup)
    expect(setup.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        deviceError: expect.stringContaining('20101'),
      }),
    )
  })
})
