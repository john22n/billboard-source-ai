import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useWorkerStatus', () => ({
  useWorkerStatus: vi.fn(),
}))

import {
  canShowIncomingNotification,
  disposeTwilioRuntime,
  refreshTwilioToken,
} from './TwilioProvider'

type RefreshRuntime = Parameters<typeof refreshTwilioToken>[0]
type RefreshDevice = Parameters<typeof refreshTwilioToken>[2]

function createRefreshRuntime(device: RefreshDevice): RefreshRuntime {
  return {
    device,
    activeCall: null,
    acceptingCall: null,
    tokenRefresh: null,
    notification: null,
    initializing: false,
    initialized: true,
    loggedOut: false,
    workerStatus: 'available',
    onCallAccepted: null,
    onCallDisconnected: null,
  }
}

describe('canShowIncomingNotification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('allows an incoming-call notification while the app is visible', () => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    vi.stubGlobal('window', { Notification: {} })
    vi.stubGlobal('Notification', { permission: 'granted' })

    expect(canShowIncomingNotification()).toBe(true)
  })

  it('does not notify when browser notification permission is denied', () => {
    vi.stubGlobal('window', { Notification: {} })
    vi.stubGlobal('Notification', { permission: 'denied' })

    expect(canShowIncomingNotification()).toBe(false)
  })

  it('does not notify when the browser does not support notifications', () => {
    vi.stubGlobal('window', {})

    expect(canShowIncomingNotification()).toBe(false)
  })
})

describe('refreshTwilioToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('updates the device token without changing worker availability', async () => {
    const updateToken = vi.fn()
    const device = { updateToken } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const update = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'replacement-token',
          identity: 'rep@example.com',
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshTwilioToken(runtime, update, device)).resolves.toBe(
      true,
    )

    expect(fetchMock).toHaveBeenCalledWith('/api/twilio-token', {
      cache: 'no-store',
    })
    expect(updateToken).toHaveBeenCalledWith('replacement-token')
    expect(runtime.workerStatus).toBe('available')
    expect(update).toHaveBeenLastCalledWith({
      userEmail: 'rep@example.com',
      deviceError: null,
    })
  })

  it('deduplicates concurrent token refresh events', async () => {
    let resolveFetch!: (response: Response) => void
    const device = { updateToken: vi.fn() } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = refreshTwilioToken(runtime, vi.fn(), device)
    const second = refreshTwilioToken(runtime, vi.fn(), device)
    resolveFetch(
      new Response(
        JSON.stringify({
          token: 'replacement-token',
          identity: 'rep@example.com',
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
        }),
      ),
    )

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(device.updateToken).toHaveBeenCalledTimes(1)
  })

  it('does not install a terminal token that would cause a refresh loop', async () => {
    const device = { updateToken: vi.fn() } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'terminal-token',
          identity: 'rep@example.com',
          expiresAt: Math.floor(Date.now() / 1000) + 30,
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshTwilioToken(runtime, vi.fn(), device)).resolves.toBe(
      true,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(device.updateToken).not.toHaveBeenCalled()
  })

  it('retries a transient token request failure', async () => {
    const device = { updateToken: vi.fn() } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Temporary error' }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: 'replacement-token',
            identity: 'rep@example.com',
            expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
          }),
        ),
      )
    const waitForRetry = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      refreshTwilioToken(runtime, vi.fn(), device, waitForRetry),
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(waitForRetry).toHaveBeenCalledWith(1_000)
    expect(device.updateToken).toHaveBeenCalledWith('replacement-token')
  })

  it('does not retry an authentication failure', async () => {
    const device = { updateToken: vi.fn() } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const update = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
      }),
    )
    const waitForRetry = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      refreshTwilioToken(runtime, update, device, waitForRetry),
    ).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(waitForRetry).not.toHaveBeenCalled()
    expect(device.updateToken).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      deviceError: 'Token refresh failed: Unauthorized',
    })
  })

  it('ignores an in-flight refresh after logout disposes the runtime', async () => {
    let resolveFetch!: (response: Response) => void
    const device = {
      destroy: vi.fn(),
      state: 'registered',
      updateToken: vi.fn(),
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const update = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
      ),
    )

    const refresh = refreshTwilioToken(runtime, update, device)
    disposeTwilioRuntime(runtime)
    resolveFetch(
      new Response(
        JSON.stringify({
          token: 'stale-token',
          identity: 'rep@example.com',
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
        }),
      ),
    )

    await expect(refresh).resolves.toBe(false)
    expect(device.destroy).toHaveBeenCalledOnce()
    expect(device.updateToken).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(runtime.loggedOut).toBe(true)
    expect(runtime.device).toBeNull()
  })
})
