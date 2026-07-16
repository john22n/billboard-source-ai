'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react'
import { Call, Device } from '@twilio/voice-sdk'
import { useWorkerStatus, type WorkerActivity } from '@/hooks/useWorkerStatus'

interface TwilioContextType {
  status: string
  twilioReady: boolean
  incomingCall: Call | null
  callActive: boolean
  userEmail: string
  deviceError: string | null
  acceptCall: () => Promise<void>
  rejectCall: () => void
  hangupCall: () => void
  destroyDevice: () => void
  updateStatus: (status: string) => void
  resetStatus: () => void
  clearDeviceError: () => void
  onCallAccepted: (callback: (call: Call) => void) => void
  onCallDisconnected: (callback: () => void) => void
}

interface TwilioState {
  status: string
  twilioReady: boolean
  incomingCall: Call | null
  callActive: boolean
  userEmail: string
  deviceError: string | null
}

interface TwilioRuntime {
  device: Device | null
  activeCall: Call | null
  acceptingCall: Call | null
  notification: Notification | null
  initializing: boolean
  initialized: boolean
  loggedOut: boolean
  workerStatus: WorkerActivity
  onCallAccepted: ((call: Call) => void) | null
  onCallDisconnected: (() => void) | null
}

interface TwilioCredentials {
  token: string
  identity: string
}

type UpdateState = Dispatch<Partial<TwilioState>>
type SetWorkerStatus = (status: WorkerActivity) => Promise<void>

const initialState: TwilioState = {
  status: 'Idle',
  twilioReady: false,
  incomingCall: null,
  callActive: false,
  userEmail: '',
  deviceError: null,
}

const TwilioContext = createContext<TwilioContextType | null>(null)

function updateTwilioState(
  state: TwilioState,
  update: Partial<TwilioState>,
): TwilioState {
  return { ...state, ...update }
}

function createRuntime(workerStatus: WorkerActivity): TwilioRuntime {
  return {
    device: null,
    activeCall: null,
    acceptingCall: null,
    notification: null,
    initializing: false,
    initialized: false,
    loggedOut: false,
    workerStatus,
    onCallAccepted: null,
    onCallDisconnected: null,
  }
}

function closeIncomingNotification(runtime: TwilioRuntime) {
  runtime.notification?.close()
  runtime.notification = null
}

function getReadyStatus(runtime: TwilioRuntime) {
  return runtime.workerStatus === 'available'
    ? 'Ready to receive calls'
    : 'Offline'
}

async function acceptIncomingCall(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
) {
  if (runtime.activeCall === call || runtime.acceptingCall === call) return

  try {
    runtime.acceptingCall = call
    closeIncomingNotification(runtime)
    update({ status: 'Accepting call...' })
    call.on('accept', () => runtime.onCallAccepted?.(call))

    await call.accept()
    runtime.activeCall = call
    update({ callActive: true, incomingCall: null })
  } catch (error) {
    console.error('Error accepting Twilio call:', error)
    update({ status: 'Failed to accept call' })
  } finally {
    runtime.acceptingCall = null
  }
}

function showIncomingNotification(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
) {
  if (!canShowIncomingNotification()) return

  closeIncomingNotification(runtime)
  const notification = new Notification('Incoming sales call', {
    body: `Call from ${call.parameters.From ?? 'Unknown caller'}. Click to answer.`,
    icon: '/favicon.ico',
    tag: 'incoming-sales-call',
    requireInteraction: true,
  })
  runtime.notification = notification
  notification.onclick = () => {
    window.focus()
    void acceptIncomingCall(runtime, update, call)
  }
}

export function canShowIncomingNotification() {
  if (!('Notification' in window)) return false
  return Notification.permission === 'granted'
}

function handleIncomingCall(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
) {
  update({
    incomingCall: call,
    status: `Incoming call from ${call.parameters.From}`,
  })
  showIncomingNotification(runtime, update, call)

  call.on('disconnect', () => {
    closeIncomingNotification(runtime)
    runtime.activeCall = null
    update({ callActive: false, incomingCall: null })
    runtime.onCallDisconnected?.()
  })
  call.on('reject', () => {
    closeIncomingNotification(runtime)
    update({ incomingCall: null })
  })
  call.on('cancel', () => {
    closeIncomingNotification(runtime)
    update({ incomingCall: null, status: 'Call canceled' })
  })
  call.on('error', (error: Error) => {
    console.error('Twilio call error:', error)
    closeIncomingNotification(runtime)
    update({ incomingCall: null })
  })
}

function handleDeviceRegistered(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
) {
  runtime.initialized = true
  console.info('Twilio device registered', {
    state: device.state,
    edge: device.edge || 'unknown',
  })
  update({
    twilioReady: true,
    status: getReadyStatus(runtime),
    deviceError: null,
  })
}

function handleDeviceUnregistered(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
) {
  if (runtime.loggedOut) return

  update({
    twilioReady: false,
    status: 'Reconnecting calling service...',
  })
  if (runtime.initializing) return

  runtime.initializing = true
  device
    .register()
    .catch((error) => console.error('Failed to re-register Twilio:', error))
    .finally(() => {
      runtime.initializing = false
    })
}

function bindDeviceEvents(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
  setWorkerStatus: SetWorkerStatus,
) {
  device.on('incoming', (call) => handleIncomingCall(runtime, update, call))
  device.on('registered', () => handleDeviceRegistered(runtime, update, device))
  device.on('unregistered', () =>
    handleDeviceUnregistered(runtime, update, device),
  )
  device.on('error', (error: Error) => {
    console.error('Twilio device error:', error)
    update({
      status: `Twilio error: ${error.message}`,
      deviceError: `Twilio error: ${error.message}`,
    })
  })
  device.on('tokenWillExpire', () => {
    void setWorkerStatus('offline').catch((error) => {
      console.error('Failed to set expiring worker offline:', error)
    })
  })
}

async function fetchTwilioCredentials(
  update: UpdateState,
): Promise<TwilioCredentials | null> {
  const response = await fetch('/api/twilio-token')
  const data = (await response.json()) as {
    token?: string
    identity?: string
    error?: string
  }

  const credentialError = getCredentialError(data)
  if (credentialError) {
    update({
      status: `Token error: ${credentialError}`,
      deviceError: `Failed to get access token: ${credentialError}`,
    })
    return null
  }
  if (!data.identity) {
    update({
      status: 'Error: No user identity in token',
      deviceError: 'No user identity found. Please log in again.',
    })
    return null
  }
  return { token: data.token!, identity: data.identity }
}

function getCredentialError(data: { token?: string; error?: string }) {
  if (data.error) return data.error
  if (!data.token) return 'No access token returned'
  return null
}

function exposeDeviceForDebugging(runtime: TwilioRuntime) {
  ;(window as typeof window & { twilioDevice?: Device }).twilioDevice =
    runtime.device ?? undefined
}

function getInitializationStatus(runtime: TwilioRuntime) {
  if (runtime.loggedOut) return 'blocked'
  if (runtime.initializing) return 'blocked'
  if (isDeviceRegistered(runtime)) return 'ready'
  return 'start'
}

function isDeviceRegistered(runtime: TwilioRuntime) {
  return runtime.initialized && runtime.device?.state === 'registered'
}

function prepareCurrentDevice(runtime: TwilioRuntime) {
  if (runtime.device?.state === 'destroyed') return
  runtime.device?.destroy()
  runtime.device = null
}

async function startTwilioDevice(
  runtime: TwilioRuntime,
  update: UpdateState,
  setWorkerStatus: SetWorkerStatus,
) {
  prepareCurrentDevice(runtime)
  const credentials = await fetchTwilioCredentials(update)
  if (!credentials) return false
  update({ userEmail: credentials.identity })

  const device = new Device(credentials.token, {
    codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
  })
  bindDeviceEvents(runtime, update, device, setWorkerStatus)
  await device.register()
  runtime.device = device
  exposeDeviceForDebugging(runtime)
  return true
}

async function initializeTwilio(
  runtime: TwilioRuntime,
  update: UpdateState,
  setWorkerStatus: SetWorkerStatus,
) {
  const status = getInitializationStatus(runtime)
  if (status === 'blocked') return false
  if (status === 'ready') return true

  try {
    runtime.initializing = true
    update({ status: 'Initializing Twilio...', deviceError: null })
    return await startTwilioDevice(runtime, update, setWorkerStatus)
  } catch (error) {
    console.error('Twilio initialization failed:', error)
    update({
      status: 'Twilio initialization failed',
      deviceError: `Initialization failed: ${getErrorMessage(error)}`,
    })
    return false
  } finally {
    runtime.initializing = false
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

function checkDeviceHealth(runtime: TwilioRuntime, update: UpdateState) {
  if (!deviceNeedsRecovery(runtime)) return
  runtime.initialized = false
  update({
    twilioReady: false,
    deviceError: 'Calling connection ended. Your login remains active.',
    status: 'Calling unavailable',
  })
}

function deviceNeedsRecovery(runtime: TwilioRuntime) {
  if (runtime.loggedOut) return false
  if (!runtime.initialized) return false
  return runtime.device?.state === 'destroyed'
}

function useTwilioLifecycle(
  runtime: TwilioRuntime,
  update: UpdateState,
  setWorkerStatus: SetWorkerStatus,
) {
  const initTwilio = useCallback(
    () => initializeTwilio(runtime, update, setWorkerStatus),
    [runtime, setWorkerStatus, update],
  )

  useEffect(() => {
    runtime.loggedOut = false
    void initTwilio()
  }, [initTwilio, runtime])

  useEffect(() => {
    const interval = window.setInterval(
      () => checkDeviceHealth(runtime, update),
      2000,
    )
    return () => window.clearInterval(interval)
  }, [runtime, update])
}

function destroyTwilioDevice(runtime: TwilioRuntime, update: UpdateState) {
  runtime.loggedOut = true
  closeIncomingNotification(runtime)
  runtime.activeCall?.disconnect()
  runtime.activeCall = null
  if (runtime.device?.state !== 'destroyed') runtime.device?.destroy()
  runtime.device = null
  runtime.initialized = false
  update({
    twilioReady: false,
    incomingCall: null,
    callActive: false,
    deviceError: null,
    status: 'Idle',
  })
}

function createCallActions(
  state: TwilioState,
  runtime: TwilioRuntime,
  update: UpdateState,
) {
  return {
    acceptCall: async () => {
      if (state.incomingCall) {
        await acceptIncomingCall(runtime, update, state.incomingCall)
      }
    },
    rejectCall: () => {
      if (!state.incomingCall) return
      void fetch('/api/call-attempts/reject', {
        method: 'POST',
        keepalive: true,
      }).catch((error) => console.error('Failed to record rejection:', error))
      closeIncomingNotification(runtime)
      state.incomingCall.reject()
      update({
        incomingCall: null,
        status: state.twilioReady ? getReadyStatus(runtime) : 'Idle',
      })
    },
    hangupCall: () => {
      if (!runtime.activeCall) return
      runtime.activeCall.disconnect()
      runtime.activeCall = null
      update({ callActive: false })
      runtime.onCallDisconnected?.()
    },
  }
}

function createContextValue(
  state: TwilioState,
  runtime: TwilioRuntime,
  update: UpdateState,
): TwilioContextType {
  return {
    ...state,
    ...createCallActions(state, runtime, update),
    destroyDevice: () => destroyTwilioDevice(runtime, update),
    updateStatus: (status) => update({ status }),
    resetStatus: () =>
      update({
        status: state.twilioReady ? getReadyStatus(runtime) : 'Idle',
      }),
    clearDeviceError: () => update({ deviceError: null }),
    onCallAccepted: (callback) => {
      runtime.onCallAccepted = callback
    },
    onCallDisconnected: (callback) => {
      runtime.onCallDisconnected = callback
    },
  }
}

function useTwilioController(): TwilioContextType {
  const [state, update] = useReducer(updateTwilioState, initialState)
  const { status: workerStatus, setStatus: setWorkerStatus } = useWorkerStatus()
  const runtimeRef = useRef<TwilioRuntime>(createRuntime(workerStatus))
  const runtime = runtimeRef.current

  useEffect(() => {
    runtime.workerStatus = workerStatus
  }, [runtime, workerStatus])

  useTwilioLifecycle(runtime, update, setWorkerStatus)

  useEffect(() => {
    if (state.twilioReady && !state.incomingCall && !state.callActive) {
      update({ status: getReadyStatus(runtime) })
    }
  }, [
    runtime,
    state.callActive,
    state.incomingCall,
    state.twilioReady,
    workerStatus,
  ])

  return createContextValue(state, runtime, update)
}

export function useTwilioContext() {
  const context = useContext(TwilioContext)
  if (!context) {
    throw new Error('useTwilioContext must be used within TwilioProvider')
  }
  return context
}

export function TwilioProvider({ children }: { children: ReactNode }) {
  const value = useTwilioController()
  return (
    <TwilioContext.Provider value={value}>{children}</TwilioContext.Provider>
  )
}
