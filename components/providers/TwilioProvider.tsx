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
  tokenRefresh: { device: Device; promise: Promise<boolean> } | null
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
  expiresAt: number
}

type UpdateState = Dispatch<Partial<TwilioState>>

const initialState: TwilioState = {
  status: 'Idle',
  twilioReady: false,
  incomingCall: null,
  callActive: false,
  userEmail: '',
  deviceError: null,
}

const TwilioContext = createContext<TwilioContextType | null>(null)
const TOKEN_REFRESH_MS = 60_000
const TOKEN_REFRESH_RETRY_DELAYS_MS = [1_000, 3_000, 5_000]
const ACCESS_TOKEN_INVALID_ERROR_CODE = 20101

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
    tokenRefresh: null,
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

export async function acceptIncomingCall(
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
    // The remote caller can hang up while this accept is still settling. In
    // that case the disconnect handler clears acceptingCall; do not resurrect
    // the already-closed call as active when this promise resumes.
    if (runtime.acceptingCall !== call) return
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

export function handleIncomingCall(
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
    if (runtime.acceptingCall === call) runtime.acceptingCall = null
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
  if (runtime.tokenRefresh?.device === device) return
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
) {
  device.on('incoming', (call) => handleIncomingCall(runtime, update, call))
  device.on('registered', () => handleDeviceRegistered(runtime, update, device))
  device.on('unregistered', () =>
    handleDeviceUnregistered(runtime, update, device),
  )
  device.on('error', (error: Error & { code?: number }) => {
    if (error.code === ACCESS_TOKEN_INVALID_ERROR_CODE) {
      void refreshTwilioToken(runtime, update, device)
      return
    }
    console.error('Twilio device error:', error)
    update({
      status: `Twilio error: ${error.message}`,
      deviceError: `Twilio error: ${error.message}`,
    })
  })
  device.on('tokenWillExpire', () => {
    void refreshTwilioToken(runtime, update, device)
  })
}

async function fetchTwilioCredentials(
  update: UpdateState,
  canUpdate = () => true,
): Promise<TwilioCredentials | null> {
  try {
    return await requestTwilioCredentials()
  } catch (error) {
    const message = getErrorMessage(error)
    if (canUpdate()) {
      update({
        status: `Token error: ${message}`,
        deviceError: `Failed to get access token: ${message}`,
      })
    }
    return null
  }
}

class CredentialRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

class LoginSessionEndingError extends Error {}

async function requestTwilioCredentials(): Promise<TwilioCredentials> {
  const response = await fetch('/api/twilio-token', { cache: 'no-store' })
  const data = (await response.json()) as Partial<TwilioCredentials> & {
    error?: string
  }
  const credentialError = getCredentialError(data)
  if (credentialError) {
    throw new CredentialRequestError(credentialError, response.status)
  }
  if (!data.identity) {
    throw new CredentialRequestError(
      'No user identity in token',
      response.status,
    )
  }
  if (!data.expiresAt) {
    throw new CredentialRequestError(
      'No access token expiration returned',
      response.status,
    )
  }
  return data as TwilioCredentials
}

function isCurrentDevice(runtime: TwilioRuntime, device: Device) {
  return !runtime.loggedOut && runtime.device === device
}

function shouldRetryTokenRequest(error: unknown) {
  if (error instanceof LoginSessionEndingError) return false
  if (!(error instanceof CredentialRequestError)) return true
  return error.status === 429 || error.status >= 500
}

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))

async function applyRefreshedToken(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
) {
  const credentials = await requestTwilioCredentials()
  if (!isCurrentDevice(runtime, device)) return false

  // Replacement tokens cannot outlive the fixed login session. Installing
  // one inside the warning window would immediately emit another warning.
  if (credentials.expiresAt * 1000 - Date.now() <= TOKEN_REFRESH_MS) {
    throw new LoginSessionEndingError(
      'Your login session is ending. Sign in again to restore calling.',
    )
  }

  device.updateToken(credentials.token)
  update({ userEmail: credentials.identity, deviceError: null })
  return true
}

function canRetryTokenRequest(
  error: unknown,
  retryDelay: number | undefined,
  runtime: TwilioRuntime,
  device: Device,
): retryDelay is number {
  return (
    retryDelay !== undefined &&
    shouldRetryTokenRequest(error) &&
    isCurrentDevice(runtime, device)
  )
}

function reportTokenRefreshError(
  error: unknown,
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
) {
  console.error('Failed to refresh Twilio access token:', error)
  if (!isCurrentDevice(runtime, device)) return
  if (error instanceof LoginSessionEndingError) {
    update({
      twilioReady: false,
      status: 'Calling unavailable',
      deviceError: error.message,
    })
    return
  }
  update({ deviceError: `Token refresh failed: ${getErrorMessage(error)}` })
}

async function restoreDeviceRegistration(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
) {
  if (!isCurrentDevice(runtime, device) || device.state !== 'unregistered') {
    return true
  }

  try {
    runtime.initializing = true
    await device.register()
    return true
  } catch (error) {
    console.error('Failed to re-register Twilio after token refresh:', error)
    if (isCurrentDevice(runtime, device)) {
      update({
        twilioReady: false,
        status: 'Calling unavailable',
        deviceError: 'Calling could not reconnect after refreshing your login.',
      })
    }
    return false
  } finally {
    runtime.initializing = false
  }
}

export async function refreshTwilioToken(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
  waitForRetry = wait,
) {
  if (!isCurrentDevice(runtime, device)) return false
  if (runtime.tokenRefresh?.device === device) {
    return runtime.tokenRefresh.promise
  }

  const refresh = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await applyRefreshedToken(runtime, update, device)
      } catch (error) {
        const retryDelay = TOKEN_REFRESH_RETRY_DELAYS_MS[attempt]
        if (canRetryTokenRequest(error, retryDelay, runtime, device)) {
          await waitForRetry(retryDelay)
          if (!isCurrentDevice(runtime, device)) return false
          continue
        }

        reportTokenRefreshError(error, runtime, update, device)
        return false
      }
    }
  })()

  runtime.tokenRefresh = { device, promise: refresh }
  try {
    const refreshed = await refresh
    if (!refreshed) return false
    return await restoreDeviceRegistration(runtime, update, device)
  } finally {
    if (runtime.tokenRefresh?.promise === refresh) runtime.tokenRefresh = null
  }
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

function discardDevice(runtime: TwilioRuntime, device: Device) {
  if (runtime.device === device) runtime.device = null
  if (device.state !== 'destroyed') device.destroy()
}

async function startTwilioDevice(runtime: TwilioRuntime, update: UpdateState) {
  prepareCurrentDevice(runtime)
  const credentials = await fetchTwilioCredentials(
    update,
    () => !runtime.loggedOut,
  )
  if (!credentials || runtime.loggedOut) return false
  update({ userEmail: credentials.identity })

  const device = new Device(credentials.token, {
    codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    tokenRefreshMs: TOKEN_REFRESH_MS,
  })
  bindDeviceEvents(runtime, update, device)
  runtime.device = device
  try {
    await device.register()
  } catch (error) {
    discardDevice(runtime, device)
    if (runtime.loggedOut) return false
    throw error
  }
  if (!isCurrentDevice(runtime, device)) {
    discardDevice(runtime, device)
    return false
  }
  exposeDeviceForDebugging(runtime)
  return true
}

async function initializeTwilio(runtime: TwilioRuntime, update: UpdateState) {
  const status = getInitializationStatus(runtime)
  if (status === 'blocked') return false
  if (status === 'ready') return true

  try {
    runtime.initializing = true
    update({ status: 'Initializing Twilio...', deviceError: null })
    return await startTwilioDevice(runtime, update)
  } catch (error) {
    if (runtime.loggedOut) return false
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

function useTwilioLifecycle(runtime: TwilioRuntime, update: UpdateState) {
  const initTwilio = useCallback(
    () => initializeTwilio(runtime, update),
    [runtime, update],
  )

  useEffect(() => {
    // The runtime is an intentionally mutable external Twilio SDK controller.
    // eslint-disable-next-line react-hooks/immutability
    runtime.loggedOut = false
    void initTwilio()
    return () => disposeTwilioRuntime(runtime)
  }, [initTwilio, runtime])

  useEffect(() => {
    const interval = window.setInterval(
      () => checkDeviceHealth(runtime, update),
      2000,
    )
    return () => window.clearInterval(interval)
  }, [runtime, update])
}

export function disposeTwilioRuntime(runtime: TwilioRuntime) {
  runtime.loggedOut = true
  closeIncomingNotification(runtime)
  runtime.activeCall?.disconnect()
  runtime.activeCall = null
  runtime.tokenRefresh = null
  if (runtime.device?.state !== 'destroyed') runtime.device?.destroy()
  runtime.device = null
  runtime.initialized = false
}

function destroyTwilioDevice(runtime: TwilioRuntime, update: UpdateState) {
  disposeTwilioRuntime(runtime)
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
  const { status: workerStatus } = useWorkerStatus()
  const runtimeRef = useRef<TwilioRuntime>(createRuntime(workerStatus))
  // The runtime has stable identity and is deliberately kept outside React state.
  // eslint-disable-next-line react-hooks/refs
  const runtime = runtimeRef.current

  useEffect(() => {
    runtime.workerStatus = workerStatus
  }, [runtime, workerStatus])

  useTwilioLifecycle(runtime, update)

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
