import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useWorkerStatus', () => ({
  useWorkerStatus: vi.fn(),
}))

import {
  acceptIncomingCall,
  canShowIncomingNotification,
  disposeTwilioRuntime,
  handleIncomingCall,
  monitorCallMicrophone,
  refreshTwilioToken,
} from './TwilioProvider'

type RefreshRuntime = Parameters<typeof refreshTwilioToken>[0]
type RefreshDevice = Parameters<typeof refreshTwilioToken>[2]
type MicrophoneRuntime = Parameters<typeof monitorCallMicrophone>[0]
type MicrophoneCall = Parameters<typeof monitorCallMicrophone>[2]

type MutableAudioTrack = EventTarget & {
  enabled: boolean
  label: string
  muted: boolean
  readyState: MediaStreamTrackState
}

function createAudioTrack(): MutableAudioTrack {
  return Object.assign(new EventTarget(), {
    enabled: true,
    label: 'USB headset microphone',
    muted: false,
    readyState: 'live' as MediaStreamTrackState,
  })
}

function createMicrophoneCall(track = createAudioTrack()) {
  const events = new EventEmitter()
  const call = {
    getLocalStream: vi.fn(() => ({ getAudioTracks: () => [track] })),
    isMuted: vi.fn(() => false),
    on: vi.fn(events.on.bind(events)),
    removeListener: vi.fn(events.removeListener.bind(events)),
  } as unknown as MicrophoneCall

  return { call, events, track }
}

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
    microphoneCleanup: null,
    microphoneWarning: null,
    microphoneLevel: 0,
    lastMicrophoneLevelUpdate: 0,
  }
}

function createCredentialsResponse(
  token = 'replacement-token',
  expiresAt = Math.floor(Date.now() / 1000) + 60 * 60,
) {
  return new Response(
    JSON.stringify({
      token,
      identity: 'rep@example.com',
      expiresAt,
    }),
  )
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

describe('acceptIncomingCall', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not reactivate a call that disconnects while accept is settling', async () => {
    type IncomingRuntime = Parameters<typeof handleIncomingCall>[0]
    type IncomingCall = Parameters<typeof handleIncomingCall>[2]
    const events = new EventEmitter()
    const call = {
      parameters: { From: '+15555550123' },
      on: vi.fn(events.on.bind(events)),
      removeListener: vi.fn(events.removeListener.bind(events)),
      accept: vi.fn(() => {
        events.emit('accept', call)
        events.emit('disconnect', call)
      }),
    } as unknown as IncomingCall
    const runtime = createRefreshRuntime({
      state: 'registered',
    } as unknown as RefreshDevice) as IncomingRuntime
    const update = vi.fn()
    vi.stubGlobal('window', {})

    handleIncomingCall(runtime, update, call)
    await acceptIncomingCall(runtime, update, call)

    expect(runtime.activeCall).toBeNull()
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ callActive: true }),
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        callActive: false,
        incomingCall: null,
      }),
    )
  })

  it('marks a call active only after Twilio confirms media acceptance', async () => {
    const { call: microphoneCall, events } = createMicrophoneCall()
    const call = Object.assign(microphoneCall, {
      accept: vi.fn(),
    })
    const runtime = createRefreshRuntime({
      state: 'registered',
    } as unknown as RefreshDevice) as MicrophoneRuntime
    const onCallAccepted = vi.fn()
    const update = vi.fn()
    runtime.onCallAccepted = onCallAccepted

    const acceptance = acceptIncomingCall(runtime, update, call)

    expect(runtime.activeCall).toBeNull()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ microphoneStatus: 'checking' }),
    )
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ callActive: true }),
    )

    events.emit('accept', call)
    await acceptance

    expect(runtime.activeCall).toBe(call)
    expect(update).toHaveBeenCalledWith({
      callActive: true,
      incomingCall: null,
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        microphoneStatus: 'connected',
        microphoneLabel: 'USB headset microphone',
      }),
    )
    expect(onCallAccepted).toHaveBeenCalledWith(call)
  })
})

describe('monitorCallMicrophone', () => {
  it('reports input level and microphone health changes', () => {
    const { call, events, track } = createMicrophoneCall()
    const runtime = createRefreshRuntime({
      state: 'registered',
    } as unknown as RefreshDevice) as MicrophoneRuntime
    const update = vi.fn()
    runtime.activeCall = call

    monitorCallMicrophone(runtime, update, call)

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        microphoneStatus: 'connected',
        microphoneLabel: 'USB headset microphone',
      }),
    )

    events.emit('volume', 0.4, 0)
    expect(update).toHaveBeenLastCalledWith({ microphoneLevel: 4 })

    events.emit('warning', 'constant-audio-input-level', {})
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ microphoneStatus: 'warning' }),
    )

    events.emit('warning-cleared', 'constant-audio-input-level')
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ microphoneStatus: 'connected' }),
    )

    track.readyState = 'ended'
    track.dispatchEvent(new Event('ended'))
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        microphoneStatus: 'disconnected',
        microphoneLevel: 0,
      }),
    )
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
    const fetchMock = vi.fn().mockResolvedValue(createCredentialsResponse())
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

  it('restores registration after refreshing an invalid access token', async () => {
    const device = {
      state: 'unregistered',
      register: vi.fn().mockResolvedValue(undefined),
      updateToken: vi.fn(),
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const activeCall = {} as NonNullable<typeof runtime.activeCall>
    runtime.activeCall = activeCall
    runtime.workerStatus = 'unavailable'
    const update = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createCredentialsResponse()),
    )

    await expect(refreshTwilioToken(runtime, update, device)).resolves.toBe(
      true,
    )
    expect(device.updateToken).toHaveBeenCalledWith('replacement-token')
    expect(device.register).toHaveBeenCalledOnce()
    expect(runtime.activeCall).toBe(activeCall)
    expect(runtime.workerStatus).toBe('unavailable')
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ deviceError: expect.any(String) }),
    )
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
    resolveFetch(createCredentialsResponse())

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(device.updateToken).toHaveBeenCalledTimes(1)
  })

  it('marks calling unavailable instead of installing a terminal token', async () => {
    const device = { updateToken: vi.fn() } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const update = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createCredentialsResponse(
          'terminal-token',
          Math.floor(Date.now() / 1000) + 30,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(refreshTwilioToken(runtime, update, device)).resolves.toBe(
      false,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(device.updateToken).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      twilioReady: false,
      status: 'Calling unavailable',
      deviceError:
        'Your login session is ending. Sign in again to restore calling.',
    })
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
      .mockResolvedValueOnce(createCredentialsResponse())
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
    resolveFetch(createCredentialsResponse('stale-token'))

    await expect(refresh).resolves.toBe(false)
    expect(device.destroy).toHaveBeenCalledOnce()
    expect(device.updateToken).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(runtime.loggedOut).toBe(true)
    expect(runtime.device).toBeNull()
  })
})
