// @vitest-environment jsdom
import { EventEmitter } from 'node:events'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkerStatus } from '@/hooks/useWorkerStatus'

const { sendTwilioClientTelemetry, MockDevice } = vi.hoisted(() => ({
  sendTwilioClientTelemetry: vi.fn(),
  MockDevice: vi.fn(),
}))

vi.mock('@twilio/voice-sdk', async () => ({
  ...(await vi.importActual('@twilio/voice-sdk')),
  Device: MockDevice,
}))

vi.mock('@/hooks/useWorkerStatus', () => ({
  useWorkerStatus: vi.fn(),
}))

vi.mock('@/lib/twilio-client-telemetry', async () => ({
  ...(await vi.importActual('../../lib/twilio-client-telemetry')),
  sendTwilioClientTelemetry,
}))

import {
  acceptIncomingCall,
  canShowIncomingNotification,
  disposeTwilioRuntime,
  getDeviceRecoveryReason,
  handleIncomingCall,
  holdTwilioDeviceOwnership,
  monitorCallMicrophone,
  prepareStandbyMicrophone,
  recoverTwilioDevice,
  refreshTwilioToken,
  TwilioProvider,
  useTwilioContext,
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
    incomingCall: null,
    tokenRefresh: null,
    deviceRecovery: null,
    tabOwnership: null,
    hasDeviceOwnership: false,
    tabId: 'test-tab',
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
    standbyMicrophoneLabel: '',
    standbyMicrophonePending: false,
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

describe('TwilioProvider connection recovery', () => {
  let renderedRoot: Root | undefined
  let renderedContainer: HTMLDivElement | undefined

  afterEach(async () => {
    if (renderedRoot) await act(async () => renderedRoot?.unmount())
    renderedContainer?.remove()
    renderedRoot = undefined
    renderedContainer = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    MockDevice.mockReset()
    sendTwilioClientTelemetry.mockClear()
  })

  async function renderCallingProvider() {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.mocked(useWorkerStatus).mockReturnValue({
      status: 'available',
    } as ReturnType<typeof useWorkerStatus>)
    vi.stubGlobal('navigator', {
      onLine: true,
      locks: { request: vi.fn((_name, _options, owner) => owner()) },
    })
    const fetchCredentials = vi.fn(async () => createCredentialsResponse())
    vi.stubGlobal('fetch', fetchCredentials)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    class BrowserDevice extends EventEmitter {
      state = 'unregistered'
      calls: EventEmitter[] = []
      isBusy = false
      destroy = vi.fn(() => {
        this.state = 'destroyed'
      })
      register = vi.fn(async () => {
        this.state = 'registering'
        await Promise.resolve()
        this.state = 'registered'
        this.emit('registered')
      })
    }
    const devices: BrowserDevice[] = []
    MockDevice.mockImplementation(function () {
      const device = new BrowserDevice()
      devices.push(device)
      return device
    })
    function CallingStatus() {
      const { status, twilioReady, incomingCall, acceptCall, callActive } =
        useTwilioContext()
      return createElement(
        'div',
        null,
        createElement('output', null, twilioReady ? 'Ready' : status),
        incomingCall &&
          createElement('button', { onClick: acceptCall }, 'Answer'),
        callActive && 'Call active',
      )
    }
    renderedContainer = document.createElement('div')
    document.body.append(renderedContainer)
    renderedRoot = createRoot(renderedContainer)
    await act(async () => {
      renderedRoot?.render(
        createElement(TwilioProvider, null, createElement(CallingStatus)),
      )
    })
    return { devices, container: renderedContainer, fetchCredentials }
  }

  it('restores calling without reloading after the initial connection fails', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.mocked(useWorkerStatus).mockReturnValue({
      status: 'available',
    } as ReturnType<typeof useWorkerStatus>)
    vi.stubGlobal('navigator', {
      onLine: true,
      locks: {
        request: vi.fn((_name, _options, owner) => owner()),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createCredentialsResponse()),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    let connectionAttempts = 0
    MockDevice.mockImplementation(function () {
      const device = Object.assign(new EventEmitter(), {
        state: 'unregistered',
        calls: [],
        isBusy: false,
        destroy: vi.fn(() => {
          device.state = 'destroyed'
        }),
        register: vi.fn(async () => {
          device.state = 'registering'
          connectionAttempts += 1
          if (connectionAttempts === 1) {
            const error = Object.assign(new Error('Connection failed'), {
              code: 31005,
            })
            device.emit('error', error)
            device.state = 'unregistered'
            device.emit('unregistered')
            throw error
          }
          device.state = 'registered'
          device.emit('registered')
        }),
      })
      return device
    })

    function CallingStatus() {
      const { status, twilioReady } = useTwilioContext()
      return createElement(
        'output',
        { 'aria-label': 'Calling connection' },
        twilioReady ? 'Ready to receive calls' : status,
      )
    }

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          createElement(TwilioProvider, null, createElement(CallingStatus)),
        )
      })
      expect(container.textContent).toBe('Twilio initialization failed')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(container.textContent).toBe('Ready to receive calls')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('restores ringing after a previously registered connection cannot re-register', async () => {
    const { devices, container } = await renderCallingProvider()
    expect(container.textContent).toBe('Ready')
    const device = devices[0]
    device.register.mockRejectedValue(new Error('Connection failed'))

    await act(async () => {
      device.state = 'unregistered'
      device.emit('unregistered')
      device.emit(
        'error',
        Object.assign(new Error('Connection failed'), { code: 31005 }),
      )
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(container.textContent).toBe('Ready')
    const call = Object.assign(new EventEmitter(), {
      parameters: { From: '+15555550123' },
      status: () => 'pending',
    })
    await act(async () => {
      devices.at(-1)?.emit('incoming', call)
    })
    expect(container.textContent).toContain('Answer')
  })

  it('clears a pending call closed by transport loss and restores ringing', async () => {
    const { devices, container, fetchCredentials } =
      await renderCallingProvider()
    const device = devices[0]
    let status = 'pending'
    const call = Object.assign(new EventEmitter(), {
      parameters: { From: '+15555550123' },
      status: () => status,
    })
    // SDK Device removes a pending call during transportClose, before Call
    // changes its status to closed. No disconnect/cancel/error follows.
    call.on('transportClose', () => {
      device.calls = []
    })
    await act(async () => {
      device.calls = [call]
      device.emit('incoming', call)
    })
    expect(container.textContent).toContain('Answer')

    await act(async () => {
      device.state = 'unregistered'
      device.emit('unregistered')
      call.emit('transportClose')
      status = 'closed'
    })
    expect(container.textContent).not.toContain('Answer')
    expect(device.destroy).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(device.destroy).toHaveBeenCalledTimes(1)
    expect(fetchCredentials).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('Ready')

    await act(async () => {
      devices.at(-1)?.emit(
        'incoming',
        Object.assign(new EventEmitter(), {
          parameters: { From: '+15555550456' },
          status: () => 'pending',
        }),
      )
    })
    expect(container.textContent).toContain('Answer')
  })

  it('does not clear a newer incoming call when an older transport closes', async () => {
    const { devices, container } = await renderCallingProvider()
    let status = 'pending'
    const oldCall = Object.assign(new EventEmitter(), {
      parameters: { From: '+15555550123' },
      status: () => status,
    })
    const newCall = Object.assign(new EventEmitter(), {
      parameters: { From: '+15555550456' },
      status: () => 'pending',
    })
    await act(async () => {
      devices[0].emit('incoming', oldCall)
      oldCall.emit('transportClose')
      status = 'closed'
      devices[0].emit('incoming', newCall)
    })
    expect(container.textContent).toContain('Answer')
    expect(devices[0].destroy).not.toHaveBeenCalled()
  })

  it.each(['online', 'focus'])(
    'checks calling immediately on browser %s restoration without retrying offline',
    async (event) => {
      const { devices, container, fetchCredentials } =
        await renderCallingProvider()
      await act(async () => {
        Object.assign(navigator, { onLine: false })
        devices[0].state = 'unregistered'
        devices[0].emit('unregistered')
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(fetchCredentials).toHaveBeenCalledTimes(1)
      expect(devices[0].destroy).not.toHaveBeenCalled()

      await act(async () => {
        Object.assign(navigator, { onLine: true })
        window.dispatchEvent(new Event(event))
      })

      expect(container.textContent).toBe('Ready')
      expect(fetchCredentials).toHaveBeenCalledTimes(2)
    },
  )

  it.each([31005, 31009])(
    'recovers an idle connection error %s even if the SDK has not emitted unregistered',
    async (code) => {
      const { devices, container } = await renderCallingProvider()
      const error = Object.assign(new Error('Transport unavailable'), { code })
      await act(async () => {
        devices[0].emit('error', error)
      })
      expect(container.textContent).not.toBe('Ready')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000)
        devices[0].emit('error', error)
        await vi.advanceTimersByTimeAsync(4_000)
      })
      expect(container.textContent).toBe('Ready')
      expect(devices).toHaveLength(2)
    },
  )

  it('lets an in-flight SDK registration finish without replacing its device', async () => {
    const { devices, container, fetchCredentials } =
      await renderCallingProvider()
    const device = devices[0]
    await act(async () => {
      device.state = 'registering'
      device.emit(
        'error',
        Object.assign(new Error('Transport unavailable'), { code: 31009 }),
      )
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(device.destroy).not.toHaveBeenCalled()
    expect(device.register).toHaveBeenCalledTimes(1)
    expect(fetchCredentials).toHaveBeenCalledTimes(1)

    await act(async () => {
      device.state = 'registered'
      device.emit('registered')
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(container.textContent).toBe('Ready')
    expect(device.destroy).not.toHaveBeenCalled()
  })

  it.each(['incoming', 'active', 'reconnecting'])(
    'does not interrupt an %s call to recover its device',
    async (phase) => {
      const { devices, container, fetchCredentials } =
        await renderCallingProvider()
      const { call, events } = createMicrophoneCall()
      let status = phase === 'incoming' ? 'pending' : 'open'
      Object.assign(call, {
        parameters: { From: '+15555550123' },
        status: () => status,
        accept: () => events.emit('accept'),
        disconnect: vi.fn(),
      })
      await act(async () => {
        devices[0].emit('incoming', call)
      })
      if (phase !== 'incoming') {
        await act(async () => container.querySelector('button')?.click())
        expect(container.textContent).toContain('Call active')
      }
      await act(async () => {
        events.emit('transportClose')
        if (phase === 'reconnecting') {
          status = 'reconnecting'
          events.emit('reconnecting', new Error('Signaling unavailable'))
        }
        devices[0].state = 'unregistered'
        devices[0].emit('unregistered')
        devices[0].emit(
          'error',
          Object.assign(new Error('Connection failed'), { code: 31005 }),
        )
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(devices[0].destroy).not.toHaveBeenCalled()
      expect(fetchCredentials).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain(
        phase === 'incoming' ? 'Answer' : 'Call active',
      )

      await act(async () => {
        events.emit('disconnect')
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(container.textContent).toBe('Ready')
    },
  )

  it('bounds failed recovery attempts despite repeated browser wakeups', async () => {
    const { devices, fetchCredentials } = await renderCallingProvider()
    fetchCredentials.mockRejectedValue(new Error('Network unavailable'))
    await act(async () => {
      devices[0].state = 'unregistered'
      devices[0].emit('unregistered')
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchCredentials).toHaveBeenCalledTimes(2)
    await act(async () => {
      for (let index = 0; index < 20; index += 1) {
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('online'))
      }
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(fetchCredentials).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(fetchCredentials).toHaveBeenCalledTimes(3)
  })
})

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
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    sendTwilioClientTelemetry.mockClear()
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
      direction: 'INCOMING',
      parameters: { CallSid: 'CA-test-call' },
      accept: vi.fn(),
      status: vi.fn(() => 'pending'),
    })
    const runtime = createRefreshRuntime({
      state: 'registered',
      edge: 'ashburn',
      isBusy: false,
      calls: [call],
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
    expect(sendTwilioClientTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'call-accept-start',
        tabId: 'test-tab',
        device: expect.objectContaining({
          state: 'registered',
          isBusy: false,
          callCount: 1,
        }),
        call: expect.objectContaining({
          sid: 'CA-test-call',
          status: 'pending',
        }),
      }),
    )
    expect(sendTwilioClientTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'call-accepted' }),
    )
  })

  it('times out a stalled acceptance and releases the call for recovery', async () => {
    vi.useFakeTimers()
    type IncomingRuntime = Parameters<typeof handleIncomingCall>[0]
    type IncomingCall = Parameters<typeof handleIncomingCall>[2]
    const events = new EventEmitter()
    const call = {
      direction: 'INCOMING',
      parameters: { CallSid: 'CA-stalled', From: '+15555550123' },
      on: vi.fn(events.on.bind(events)),
      removeListener: vi.fn(events.removeListener.bind(events)),
      accept: vi.fn(),
      disconnect: vi.fn(),
      status: vi.fn(() => 'pending'),
    } as unknown as IncomingCall
    const runtime = createRefreshRuntime({
      calls: [call],
      isBusy: true,
      state: 'registered',
    } as unknown as RefreshDevice) as IncomingRuntime
    const onCallDisconnected = vi.fn()
    const update = vi.fn()
    runtime.onCallDisconnected = onCallDisconnected
    vi.stubGlobal('window', {})
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    handleIncomingCall(runtime, update, call)
    const acceptance = acceptIncomingCall(runtime, update, call)
    await vi.advanceTimersByTimeAsync(10_000)
    await acceptance

    expect(call.disconnect).toHaveBeenCalledOnce()
    expect(runtime.acceptingCall).toBeNull()
    expect(runtime.incomingCall).toBeNull()
    expect(onCallDisconnected).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        callActive: false,
        incomingCall: null,
        status: 'Failed to accept call',
      }),
    )
    expect(sendTwilioClientTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'call-accept-error',
        error: expect.objectContaining({
          name: 'CallAcceptanceTimeoutError',
        }),
      }),
    )
  })

  it('clears an accepting call when Twilio cancels it', async () => {
    type IncomingRuntime = Parameters<typeof handleIncomingCall>[0]
    type IncomingCall = Parameters<typeof handleIncomingCall>[2]
    const events = new EventEmitter()
    const call = {
      parameters: { CallSid: 'CA-canceled', From: '+15555550123' },
      on: vi.fn(events.on.bind(events)),
      removeListener: vi.fn(events.removeListener.bind(events)),
      accept: vi.fn(),
      status: vi.fn(() => 'pending'),
    } as unknown as IncomingCall
    const runtime = createRefreshRuntime({
      state: 'registered',
    } as unknown as RefreshDevice) as IncomingRuntime
    const update = vi.fn()
    vi.stubGlobal('window', {})

    handleIncomingCall(runtime, update, call)
    const acceptance = acceptIncomingCall(runtime, update, call)
    events.emit('cancel', call)
    await acceptance

    expect(runtime.acceptingCall).toBeNull()
    expect(runtime.incomingCall).toBeNull()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Call canceled' }),
    )
  })

  it('ignores a delayed disconnect from an older call', () => {
    type IncomingRuntime = Parameters<typeof handleIncomingCall>[0]
    type IncomingCall = Parameters<typeof handleIncomingCall>[2]
    const events = new EventEmitter()
    const oldCall = {
      parameters: { CallSid: 'CA-old', From: '+15555550123' },
      on: vi.fn(events.on.bind(events)),
      status: vi.fn(() => 'closed'),
    } as unknown as IncomingCall
    const newerCall = {} as IncomingCall
    const runtime = createRefreshRuntime({
      state: 'registered',
    } as unknown as RefreshDevice) as IncomingRuntime
    const onCallDisconnected = vi.fn()
    const update = vi.fn()
    runtime.onCallDisconnected = onCallDisconnected
    vi.stubGlobal('window', {})

    handleIncomingCall(runtime, update, oldCall)
    runtime.incomingCall = null
    runtime.activeCall = newerCall
    update.mockClear()
    events.emit('disconnect', oldCall)

    expect(runtime.activeCall).toBe(newerCall)
    expect(update).not.toHaveBeenCalled()
    expect(onCallDisconnected).not.toHaveBeenCalled()
  })

  it('truncates SDK errors to the server telemetry contract', async () => {
    type IncomingRuntime = Parameters<typeof handleIncomingCall>[0]
    type IncomingCall = Parameters<typeof handleIncomingCall>[2]
    const events = new EventEmitter()
    const error = Object.assign(new Error('m'.repeat(700)), {
      name: 'n'.repeat(200),
      code: 'c'.repeat(100),
    })
    const call = {
      direction: 'd'.repeat(50),
      parameters: {
        CallSid: 's'.repeat(100),
        From: '+15555550123',
      },
      on: vi.fn(events.on.bind(events)),
      removeListener: vi.fn(events.removeListener.bind(events)),
      accept: vi.fn(() => {
        throw error
      }),
      disconnect: vi.fn(),
      status: vi.fn(() => 'p'.repeat(50)),
    } as unknown as IncomingCall
    const runtime = createRefreshRuntime({
      calls: [call],
      edge: 'e'.repeat(100),
      state: 'r'.repeat(50),
    } as unknown as RefreshDevice) as IncomingRuntime
    vi.stubGlobal('window', {})
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    handleIncomingCall(runtime, vi.fn(), call)
    await acceptIncomingCall(runtime, vi.fn(), call)

    const payload = sendTwilioClientTelemetry.mock.calls
      .map(([event]) => event)
      .find((event) => event.event === 'call-accept-error')
    expect(payload).toMatchObject({
      call: {
        sid: 's'.repeat(64),
        direction: 'd'.repeat(32),
        status: 'p'.repeat(32),
      },
      device: {
        state: 'r'.repeat(32),
        edge: 'e'.repeat(64),
      },
      error: {
        name: 'n'.repeat(128),
        message: 'm'.repeat(500),
        code: 'c'.repeat(64),
      },
    })
  })
})

function createExclusiveLockManager() {
  let previousRequest = Promise.resolve<unknown>(undefined)
  return {
    request: vi.fn(
      (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock) => unknown,
      ) => {
        const request = previousRequest.then(() =>
          callback({ name, mode: 'exclusive' }),
        )
        previousRequest = request.then(
          () => undefined,
          () => undefined,
        )
        return request
      },
    ),
  } as unknown as LockManager
}

describe('Twilio device ownership', () => {
  it('allows only one tab to initialize the Twilio device at a time', async () => {
    const lockManager = createExclusiveLockManager()
    const firstRuntime = createRefreshRuntime({
      destroy: vi.fn(),
      state: 'registered',
    } as unknown as RefreshDevice)
    const secondRuntime = createRefreshRuntime({
      destroy: vi.fn(),
      state: 'registered',
    } as unknown as RefreshDevice)
    const firstInitialize = vi.fn().mockResolvedValue(true)
    const secondInitialize = vi.fn().mockResolvedValue(true)

    const firstOwnership = holdTwilioDeviceOwnership(
      firstRuntime,
      vi.fn(),
      lockManager,
      firstInitialize,
    )
    const secondOwnership = holdTwilioDeviceOwnership(
      secondRuntime,
      vi.fn(),
      lockManager,
      secondInitialize,
    )

    await vi.waitFor(() => expect(firstInitialize).toHaveBeenCalledOnce())
    expect(secondInitialize).not.toHaveBeenCalled()
    expect(firstRuntime.hasDeviceOwnership).toBe(true)
    expect(secondRuntime.hasDeviceOwnership).toBe(false)

    disposeTwilioRuntime(firstRuntime)
    await vi.waitFor(() => expect(secondInitialize).toHaveBeenCalledOnce())
    expect(secondRuntime.hasDeviceOwnership).toBe(true)

    disposeTwilioRuntime(secondRuntime)
    await Promise.all([firstOwnership, secondOwnership])
  })

  it('fails closed when the browser cannot coordinate tabs', async () => {
    const runtime = createRefreshRuntime({
      state: 'registered',
    } as unknown as RefreshDevice)
    const initialize = vi.fn().mockResolvedValue(true)
    const update = vi.fn()

    await holdTwilioDeviceOwnership(runtime, update, null, initialize)

    expect(initialize).not.toHaveBeenCalled()
    expect(runtime.hasDeviceOwnership).toBe(false)
    expect(update).toHaveBeenLastCalledWith({
      twilioReady: false,
      status: 'Calling unavailable in this browser',
      deviceError:
        'Safe call coordination is unavailable. Update Chrome and reload this page.',
    })
  })
})

describe('Twilio device recovery', () => {
  it('rebuilds a device that is busy without an app-owned call', async () => {
    const destroy = vi.fn()
    const device = {
      calls: [],
      destroy,
      isBusy: true,
      state: 'registered',
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    const startDevice = vi.fn().mockResolvedValue(true)
    runtime.hasDeviceOwnership = true

    expect(getDeviceRecoveryReason(runtime)).toBe(
      'device-busy-without-active-call',
    )
    await expect(
      recoverTwilioDevice(
        runtime,
        vi.fn(),
        'device-busy-without-active-call',
        startDevice,
      ),
    ).resolves.toBe(true)

    expect(destroy).toHaveBeenCalledOnce()
    expect(startDevice).toHaveBeenCalledOnce()
    expect(sendTwilioClientTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'device-recovery-start',
        reason: 'device-busy-without-active-call',
      }),
    )
    expect(sendTwilioClientTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'device-recovery-succeeded' }),
    )
  })

  it('does not recover while the app owns an active call', () => {
    const device = {
      calls: [],
      isBusy: true,
      state: 'registered',
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device)
    runtime.activeCall = {} as NonNullable<typeof runtime.activeCall>

    expect(getDeviceRecoveryReason(runtime)).toBeNull()
  })
})

describe('standby microphone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports Twilio’s default input label before a call', async () => {
    const defaultInput = {
      deviceId: 'default',
      groupId: 'built-in',
      label: 'Default - MacBook Pro Microphone',
    } as MediaDeviceInfo
    const physicalInput = {
      deviceId: 'built-in-microphone',
      groupId: 'built-in',
      label: 'MacBook Pro Microphone',
    } as MediaDeviceInfo
    const audio = {
      inputDevice: null as MediaDeviceInfo | null,
      availableInputDevices: new Map([
        ['default', defaultInput],
        ['built-in-microphone', physicalInput],
      ]),
    }
    const device = {
      audio,
      state: 'registered',
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device) as MicrophoneRuntime
    const update = vi.fn()

    await prepareStandbyMicrophone(runtime, update, device)

    expect(update).toHaveBeenCalledWith({
      microphoneLabel: 'MacBook Pro Microphone',
    })
  })

  it('requests permission to replace Twilio’s unknown-device placeholder', async () => {
    const unknownInput = {
      deviceId: 'built-in-microphone',
      label: 'Unknown Audio Input Device 1',
    } as MediaDeviceInfo
    const audio = {
      inputDevice: null,
      availableInputDevices: new Map([['built-in-microphone', unknownInput]]),
    }
    const device = {
      audio,
      state: 'registered',
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device) as MicrophoneRuntime
    const update = vi.fn()
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({
      getAudioTracks: () => [{ label: 'MacBook Pro Microphone' }],
      getTracks: () => [{ stop }],
    } as unknown as MediaStream)

    await prepareStandbyMicrophone(runtime, update, device, getUserMedia)

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith({
      microphoneLabel: 'MacBook Pro Microphone',
    })
  })

  it('retains the selected input label while an incoming call is waiting', () => {
    type IncomingRuntime = Parameters<typeof handleIncomingCall>[0]
    type IncomingCall = Parameters<typeof handleIncomingCall>[2]
    const inputDevice = {
      deviceId: 'default',
      label: 'USB headset microphone',
    } as MediaDeviceInfo
    const device = {
      audio: { inputDevice },
      state: 'registered',
    } as unknown as RefreshDevice
    const runtime = createRefreshRuntime(device) as IncomingRuntime
    const events = new EventEmitter()
    const call = {
      parameters: { From: '+15555550123' },
      on: vi.fn(events.on.bind(events)),
    } as unknown as IncomingCall
    const update = vi.fn()
    vi.stubGlobal('window', {})

    handleIncomingCall(runtime, update, call)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        microphoneStatus: 'idle',
        microphoneLabel: 'USB headset microphone',
      }),
    )
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
