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
import {
  sendTwilioClientTelemetry,
  TWILIO_CLIENT_TELEMETRY_LIMITS,
  type TwilioCallSnapshot,
  type TwilioClientEventName,
  type TwilioDeviceSnapshot,
} from '@/lib/twilio-client-telemetry'

export type MicrophoneStatus =
  | 'idle'
  | 'checking'
  | 'connected'
  | 'muted'
  | 'warning'
  | 'disconnected'

interface TwilioContextType {
  status: string
  twilioReady: boolean
  incomingCall: Call | null
  callActive: boolean
  microphoneStatus: MicrophoneStatus
  microphoneLevel: number
  microphoneLabel: string
  microphoneMessage: string | null
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
  microphoneStatus: MicrophoneStatus
  microphoneLevel: number
  microphoneLabel: string
  microphoneMessage: string | null
  userEmail: string
  deviceError: string | null
}

interface TwilioRuntime {
  device: Device | null
  activeCall: Call | null
  acceptingCall: Call | null
  incomingCall: Call | null
  tokenRefresh: { device: Device; promise: Promise<boolean> } | null
  deviceRecovery: Promise<boolean> | null
  tabOwnership: TwilioTabOwnership | null
  hasDeviceOwnership: boolean
  tabId: string
  notification: Notification | null
  initializing: boolean
  initialized: boolean
  loggedOut: boolean
  workerStatus: WorkerActivity
  onCallAccepted: ((call: Call) => void) | null
  onCallDisconnected: (() => void) | null
  microphoneCleanup: (() => void) | null
  microphoneWarning: string | null
  microphoneLevel: number
  lastMicrophoneLevelUpdate: number
}

interface TwilioTabOwnership {
  abortController: AbortController
  release: () => void
  released: Promise<void>
}

interface TwilioCredentials {
  token: string
  identity: string
  expiresAt: number
}

type UpdateState = Dispatch<Partial<TwilioState>>

type TwilioDeviceRecoveryReason =
  | 'device-missing'
  | 'device-destroyed'
  | 'device-busy-without-active-call'
  | 'device-has-untracked-calls'
  | 'call-ended-during-accept'
  | 'call-accept-error'
  | 'call-accept-timeout'

const initialState: TwilioState = {
  status: 'Idle',
  twilioReady: false,
  incomingCall: null,
  callActive: false,
  microphoneStatus: 'idle',
  microphoneLevel: 0,
  microphoneLabel: '',
  microphoneMessage: null,
  userEmail: '',
  deviceError: null,
}

const TwilioContext = createContext<TwilioContextType | null>(null)
const TOKEN_REFRESH_MS = 60_000
const TOKEN_REFRESH_RETRY_DELAYS_MS = [1_000, 3_000, 5_000]
const ACCESS_TOKEN_INVALID_ERROR_CODE = 20101
const CONSTANT_AUDIO_INPUT_WARNING = 'constant-audio-input-level'
const MICROPHONE_VOLUME_UPDATE_MS = 150
const TWILIO_DEVICE_LOCK_NAME = 'billboard-source-twilio-device'
const CALL_ACCEPT_TIMEOUT_MS = 10_000
const telemetryLimits = TWILIO_CLIENT_TELEMETRY_LIMITS

class CallAcceptanceTimeoutError extends Error {
  constructor() {
    super('Twilio did not confirm call acceptance within 10 seconds')
    this.name = 'CallAcceptanceTimeoutError'
  }
}

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
    incomingCall: null,
    tokenRefresh: null,
    deviceRecovery: null,
    tabOwnership: null,
    hasDeviceOwnership: false,
    tabId: createTabId(),
    notification: null,
    initializing: false,
    initialized: false,
    loggedOut: false,
    workerStatus,
    onCallAccepted: null,
    onCallDisconnected: null,
    microphoneCleanup: null,
    microphoneWarning: null,
    microphoneLevel: 0,
    lastMicrophoneLevelUpdate: 0,
  }
}

function createTabId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function truncateTelemetryValue(value: string | null, maxLength: number) {
  return value?.slice(0, maxLength) ?? null
}

function getCallSnapshot(call: Call): TwilioCallSnapshot {
  let status: string | null = null
  try {
    status = call.status()
  } catch {
    // A destroyed SDK call can reject status access. The remaining device
    // snapshot is still useful for diagnosing the transition.
  }

  return {
    sid: truncateTelemetryValue(
      call.parameters.CallSid ?? null,
      telemetryLimits.callSid,
    ),
    direction: truncateTelemetryValue(
      call.direction ?? null,
      telemetryLimits.callDirection,
    ),
    status: truncateTelemetryValue(status, telemetryLimits.callStatus),
  }
}

function getDeviceCalls(device: Device | null) {
  if (!device) return []
  try {
    return device.calls ?? []
  } catch {
    return []
  }
}

function getDeviceSnapshot(device: Device | null): TwilioDeviceSnapshot {
  const calls = getDeviceCalls(device)
  return {
    state: truncateTelemetryValue(
      device?.state ?? null,
      telemetryLimits.deviceState,
    ),
    isBusy: device?.isBusy ?? null,
    edge: truncateTelemetryValue(
      device?.edge ?? null,
      telemetryLimits.deviceEdge,
    ),
    callCount: Math.min(calls.length, telemetryLimits.deviceCallCount),
    calls: calls.slice(0, telemetryLimits.deviceCalls).map(getCallSnapshot),
  }
}

function getErrorSnapshot(error: unknown) {
  if (error === undefined) return undefined
  const code = getErrorCode(error)
  return {
    name: (error instanceof Error ? error.name : 'UnknownError').slice(
      0,
      telemetryLimits.errorName,
    ),
    message: getErrorMessage(error).slice(
      0,
      telemetryLimits.errorMessageMaxLength,
    ),
    code:
      typeof code === 'string'
        ? code.slice(0, telemetryLimits.errorCode)
        : code,
  }
}

function reportTwilioClientEvent(
  runtime: TwilioRuntime,
  event: TwilioClientEventName,
  options: { call?: Call; error?: unknown; reason?: string } = {},
) {
  sendTwilioClientTelemetry({
    event,
    occurredAt: new Date().toISOString(),
    tabId: runtime.tabId.slice(0, telemetryLimits.tabId),
    reason: options.reason?.slice(0, telemetryLimits.reason),
    device: getDeviceSnapshot(runtime.device),
    call: options.call ? getCallSnapshot(options.call) : undefined,
    error: getErrorSnapshot(options.error),
  })
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error))
    return undefined
  const code = error.code
  return typeof code === 'number' || typeof code === 'string' ? code : undefined
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

function getIdleMicrophoneState() {
  return {
    microphoneStatus: 'idle' as const,
    microphoneLevel: 0,
    microphoneLabel: '',
    microphoneMessage: null,
  }
}

function getMicrophoneLevel(inputVolume: number) {
  if (inputVolume >= 0.35) return 4
  if (inputVolume >= 0.15) return 3
  if (inputVolume >= 0.05) return 2
  if (inputVolume >= 0.01) return 1
  return 0
}

function getLocalAudioTrack(call: Call) {
  return call.getLocalStream()?.getAudioTracks()[0] ?? null
}

function clearMicrophoneMonitoring(runtime: TwilioRuntime) {
  runtime.microphoneCleanup?.()
  runtime.microphoneCleanup = null
  runtime.microphoneWarning = null
  runtime.microphoneLevel = 0
  runtime.lastMicrophoneLevelUpdate = 0
}

function hasNoLiveMicrophoneTrack(track: MediaStreamTrack | null) {
  return !track || track.readyState === 'ended'
}

function isCallMicrophoneMuted(call: Call, track: MediaStreamTrack | null) {
  return call.isMuted() || !track?.enabled
}

function getCallMicrophoneStatus(
  runtime: TwilioRuntime,
  call: Call,
  track: MediaStreamTrack | null,
): MicrophoneStatus {
  if (hasNoLiveMicrophoneTrack(track)) return 'disconnected'
  if (isCallMicrophoneMuted(call, track)) return 'muted'
  if (track?.muted) return 'disconnected'
  return runtime.microphoneWarning ? 'warning' : 'connected'
}

function getMicrophoneMessage(
  status: MicrophoneStatus,
  track: MediaStreamTrack | null,
  warning: string | null,
) {
  const messages: Record<MicrophoneStatus, string | null> = {
    idle: null,
    checking: 'Connecting to your microphone...',
    connected: 'Your microphone is connected. Speak to check the meter.',
    muted: 'Your microphone is muted. The caller cannot hear you.',
    warning,
    disconnected: hasNoLiveMicrophoneTrack(track)
      ? 'No live microphone is connected to this call.'
      : 'Your browser is not receiving audio from this microphone.',
  }
  return messages[status]
}

function syncMicrophoneState(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
) {
  if (runtime.activeCall !== call) return

  const track = getLocalAudioTrack(call)
  const microphoneStatus = getCallMicrophoneStatus(runtime, call, track)
  const microphoneLevel =
    microphoneStatus === 'muted' || microphoneStatus === 'disconnected'
      ? 0
      : runtime.microphoneLevel
  runtime.microphoneLevel = microphoneLevel

  update({
    microphoneStatus,
    microphoneLevel,
    microphoneLabel: track?.label || 'Default microphone',
    microphoneMessage: getMicrophoneMessage(
      microphoneStatus,
      track,
      runtime.microphoneWarning,
    ),
  })
}

export function monitorCallMicrophone(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
) {
  clearMicrophoneMonitoring(runtime)

  const track = getLocalAudioTrack(call)
  const sync = () => syncMicrophoneState(runtime, update, call)
  const handleVolume = (inputVolume: number) => {
    const level = getMicrophoneLevel(inputVolume)
    if (level === runtime.microphoneLevel) return

    const now = Date.now()
    if (now - runtime.lastMicrophoneLevelUpdate < MICROPHONE_VOLUME_UPDATE_MS) {
      return
    }
    runtime.microphoneLevel = level
    runtime.lastMicrophoneLevelUpdate = now
    update({ microphoneLevel: level })
  }
  const handleMute = () => sync()
  const handleWarning = (warningName: string) => {
    if (warningName !== CONSTANT_AUDIO_INPUT_WARNING) return
    runtime.microphoneWarning =
      'Microphone audio looks silent or stuck. Check the selected input and hardware mute switch.'
    sync()
  }
  const handleWarningCleared = (warningName: string) => {
    if (warningName !== CONSTANT_AUDIO_INPUT_WARNING) return
    runtime.microphoneWarning = null
    sync()
  }

  track?.addEventListener('ended', sync)
  track?.addEventListener('mute', sync)
  track?.addEventListener('unmute', sync)
  call.on('volume', handleVolume)
  call.on('mute', handleMute)
  call.on('warning', handleWarning)
  call.on('warning-cleared', handleWarningCleared)

  runtime.microphoneCleanup = () => {
    track?.removeEventListener('ended', sync)
    track?.removeEventListener('mute', sync)
    track?.removeEventListener('unmute', sync)
    call.removeListener('volume', handleVolume)
    call.removeListener('mute', handleMute)
    call.removeListener('warning', handleWarning)
    call.removeListener('warning-cleared', handleWarningCleared)
  }
  sync()
}

function waitForCallAcceptance(call: Call) {
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      call.removeListener('accept', handleAccept)
      call.removeListener('disconnect', handleClose)
      call.removeListener('cancel', handleClose)
      call.removeListener('error', handleError)
    }
    const handleAccept = () => {
      cleanup()
      resolve(true)
    }
    const handleClose = () => {
      cleanup()
      resolve(false)
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const timeout = setTimeout(
      () => handleError(new CallAcceptanceTimeoutError()),
      CALL_ACCEPT_TIMEOUT_MS,
    )
    call.on('accept', handleAccept)
    call.on('disconnect', handleClose)
    call.on('cancel', handleClose)
    call.on('error', handleError)
    try {
      call.accept()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

async function handleCallAcceptanceFailure(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
  error: unknown,
) {
  console.error('Error accepting Twilio call:', error)
  reportTwilioClientEvent(runtime, 'call-accept-error', { call, error })
  const ownedCallState =
    runtime.acceptingCall === call || runtime.incomingCall === call
  if (runtime.acceptingCall === call) runtime.acceptingCall = null
  if (runtime.incomingCall === call) runtime.incomingCall = null
  closeIncomingNotification(runtime)
  try {
    call.disconnect()
  } catch (disconnectError) {
    console.warn(
      'Failed to disconnect unaccepted Twilio call:',
      disconnectError,
    )
  }
  update({
    status: 'Failed to accept call',
    callActive: false,
    incomingCall: null,
    microphoneStatus: 'disconnected',
    microphoneLevel: 0,
    microphoneLabel: '',
    microphoneMessage:
      'The microphone did not connect. Check browser permission and your input device.',
  })
  if (ownedCallState) runtime.onCallDisconnected?.()
  await recoverTwilioDevice(
    runtime,
    update,
    error instanceof CallAcceptanceTimeoutError
      ? 'call-accept-timeout'
      : 'call-accept-error',
  )
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
    reportTwilioClientEvent(runtime, 'call-accept-start', { call })
    update({
      status: 'Accepting call...',
      microphoneStatus: 'checking',
      microphoneLevel: 0,
      microphoneLabel: '',
      microphoneMessage: 'Connecting to your microphone...',
    })

    const accepted = await waitForCallAcceptance(call)
    // The remote caller can hang up while this accept is still settling. In
    // that case the disconnect handler clears acceptingCall; do not resurrect
    // the already-closed call as active when this promise resumes.
    if (!accepted || runtime.acceptingCall !== call) {
      reportTwilioClientEvent(runtime, 'call-accept-ended', {
        call,
        reason: 'ended-before-media-connected',
      })
      await recoverTwilioDevice(runtime, update, 'call-ended-during-accept')
      return
    }
    runtime.activeCall = call
    runtime.incomingCall = null
    update({ callActive: true, incomingCall: null })
    monitorCallMicrophone(runtime, update, call)
    reportTwilioClientEvent(runtime, 'call-accepted', { call })
    runtime.onCallAccepted?.(call)
  } catch (error) {
    await handleCallAcceptanceFailure(runtime, update, call, error)
  } finally {
    if (runtime.acceptingCall === call) runtime.acceptingCall = null
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
  runtime.incomingCall = call
  reportTwilioClientEvent(runtime, 'call-incoming', { call })
  update({
    incomingCall: call,
    status: `Incoming call from ${call.parameters.From}`,
    ...getIdleMicrophoneState(),
  })
  showIncomingNotification(runtime, update, call)

  call.on('disconnect', () => {
    reportTwilioClientEvent(runtime, 'call-disconnected', { call })
    const wasAccepting = runtime.acceptingCall === call
    const wasIncoming = runtime.incomingCall === call
    const wasActive = runtime.activeCall === call
    if (!wasAccepting && !wasIncoming && !wasActive) return

    closeIncomingNotification(runtime)
    if (wasAccepting) runtime.acceptingCall = null
    if (wasIncoming) runtime.incomingCall = null
    if (wasActive) {
      runtime.activeCall = null
      clearMicrophoneMonitoring(runtime)
    }
    update({
      callActive: false,
      incomingCall: null,
      ...getIdleMicrophoneState(),
    })
    runtime.onCallDisconnected?.()
  })
  call.on('reject', () => {
    if (runtime.incomingCall !== call) return
    closeIncomingNotification(runtime)
    runtime.incomingCall = null
    update({ incomingCall: null, ...getIdleMicrophoneState() })
  })
  call.on('cancel', () => {
    reportTwilioClientEvent(runtime, 'call-canceled', { call })
    const wasAccepting = runtime.acceptingCall === call
    const wasIncoming = runtime.incomingCall === call
    if (!wasAccepting && !wasIncoming) return

    closeIncomingNotification(runtime)
    if (wasAccepting) runtime.acceptingCall = null
    if (wasIncoming) runtime.incomingCall = null
    update({
      incomingCall: null,
      status: 'Call canceled',
      ...getIdleMicrophoneState(),
    })
  })
  call.on('error', (error: Error) => {
    console.error('Twilio call error:', error)
    reportTwilioClientEvent(runtime, 'call-error', { call, error })
    if (runtime.acceptingCall === call) return
    if (runtime.incomingCall !== call) return

    closeIncomingNotification(runtime)
    runtime.incomingCall = null
    update({ incomingCall: null })
  })
}

function handleDeviceRegistered(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
) {
  if (!isCurrentDevice(runtime, device)) return
  runtime.initialized = true
  console.info('Twilio device registered', {
    state: device.state,
    edge: device.edge || 'unknown',
  })
  reportTwilioClientEvent(runtime, 'device-registered')
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
  if (!isCurrentDevice(runtime, device)) return

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
  device.on('incoming', (call) => {
    if (!isCurrentDevice(runtime, device)) {
      call.ignore()
      return
    }
    handleIncomingCall(runtime, update, call)
  })
  device.on('registered', () => handleDeviceRegistered(runtime, update, device))
  device.on('unregistered', () =>
    handleDeviceUnregistered(runtime, update, device),
  )
  device.on('error', (error: Error & { code?: number }) => {
    if (!isCurrentDevice(runtime, device)) return
    if (error.code === ACCESS_TOKEN_INVALID_ERROR_CODE) {
      void refreshTwilioToken(runtime, update, device)
      return
    }
    console.error('Twilio device error:', error)
    reportTwilioClientEvent(runtime, 'device-error', { error })
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
  if (!runtime.hasDeviceOwnership) return 'blocked'
  if (runtime.initializing) return 'blocked'
  if (isDeviceRegistered(runtime)) return 'ready'
  return 'start'
}

function isDeviceRegistered(runtime: TwilioRuntime) {
  return runtime.initialized && runtime.device?.state === 'registered'
}

function prepareCurrentDevice(runtime: TwilioRuntime) {
  const device = runtime.device
  runtime.device = null
  if (device?.state !== 'destroyed') device?.destroy()
}

function discardDevice(runtime: TwilioRuntime, device: Device) {
  if (runtime.device === device) runtime.device = null
  if (device.state !== 'destroyed') device.destroy()
}

async function startTwilioDevice(runtime: TwilioRuntime, update: UpdateState) {
  if (!runtime.hasDeviceOwnership) return false
  prepareCurrentDevice(runtime)
  const credentials = await fetchTwilioCredentials(
    update,
    () => !runtime.loggedOut,
  )
  if (!credentials || runtime.loggedOut || !runtime.hasDeviceOwnership) {
    return false
  }
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

export function getDeviceRecoveryReason(runtime: TwilioRuntime) {
  if (runtime.loggedOut || !runtime.hasDeviceOwnership) return null
  if (!runtime.initialized || runtime.deviceRecovery) return null
  if (runtime.activeCall || runtime.acceptingCall || runtime.incomingCall) {
    return null
  }

  const device = runtime.device
  if (!device) return 'device-missing'
  if (device.state === 'destroyed') return 'device-destroyed'
  if (device.isBusy) return 'device-busy-without-active-call'
  if (getDeviceCalls(device).length > 0) return 'device-has-untracked-calls'
  return null
}

export async function recoverTwilioDevice(
  runtime: TwilioRuntime,
  update: UpdateState,
  reason: TwilioDeviceRecoveryReason,
  startDevice = startTwilioDevice,
) {
  if (runtime.loggedOut || !runtime.hasDeviceOwnership) return false
  if (runtime.activeCall || runtime.acceptingCall || runtime.incomingCall) {
    return false
  }
  if (runtime.deviceRecovery) return runtime.deviceRecovery

  const recovery = (async () => {
    reportTwilioClientEvent(runtime, 'device-recovery-start', { reason })
    update({
      twilioReady: false,
      status: 'Restoring calling connection...',
      deviceError: null,
    })

    const device = runtime.device
    runtime.device = null
    runtime.initialized = false
    if (device?.state !== 'destroyed') device?.destroy()

    try {
      const recovered = await startDevice(runtime, update)
      if (!recovered) {
        reportTwilioClientEvent(runtime, 'device-recovery-failed', {
          reason,
        })
        if (!runtime.loggedOut) {
          update({
            twilioReady: false,
            status: 'Calling unavailable',
            deviceError: 'Calling could not restore its connection.',
          })
        }
        return false
      }

      reportTwilioClientEvent(runtime, 'device-recovery-succeeded', { reason })
      return true
    } catch (error) {
      console.error('Failed to recover Twilio device:', error)
      reportTwilioClientEvent(runtime, 'device-recovery-failed', {
        reason,
        error,
      })
      if (!runtime.loggedOut) {
        update({
          twilioReady: false,
          status: 'Calling unavailable',
          deviceError: `Calling could not reconnect: ${getErrorMessage(error)}`,
        })
      }
      return false
    }
  })()

  runtime.deviceRecovery = recovery
  try {
    return await recovery
  } finally {
    if (runtime.deviceRecovery === recovery) runtime.deviceRecovery = null
  }
}

function checkDeviceHealth(runtime: TwilioRuntime, update: UpdateState) {
  const reason = getDeviceRecoveryReason(runtime)
  if (reason) void recoverTwilioDevice(runtime, update, reason)
}

function createTabOwnership(): TwilioTabOwnership {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    abortController: new AbortController(),
    release,
    released,
  }
}

function getBrowserLockManager() {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null
  return navigator.locks
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export async function holdTwilioDeviceOwnership(
  runtime: TwilioRuntime,
  update: UpdateState,
  lockManager: LockManager | null = getBrowserLockManager(),
  initializeDevice = initializeTwilio,
) {
  const ownership = createTabOwnership()
  runtime.tabOwnership = ownership
  runtime.hasDeviceOwnership = false
  update({
    twilioReady: false,
    status: 'Calling is active in another tab',
    deviceError: null,
  })
  reportTwilioClientEvent(runtime, 'tab-ownership-waiting')

  const runAsOwner = async () => {
    if (runtime.loggedOut || runtime.tabOwnership !== ownership) return
    runtime.hasDeviceOwnership = true
    reportTwilioClientEvent(runtime, 'tab-ownership-acquired')
    await initializeDevice(runtime, update)
    await ownership.released
  }

  if (!lockManager) {
    reportTwilioClientEvent(runtime, 'tab-coordination-unavailable', {
      reason: 'web-locks-unavailable',
    })
    runtime.tabOwnership = null
    update({
      twilioReady: false,
      status: 'Calling unavailable in this browser',
      deviceError:
        'Safe call coordination is unavailable. Update Chrome and reload this page.',
    })
    return
  }

  try {
    await lockManager.request(
      TWILIO_DEVICE_LOCK_NAME,
      { mode: 'exclusive', signal: ownership.abortController.signal },
      runAsOwner,
    )
  } catch (error) {
    if (isAbortError(error)) return
    console.error('Twilio tab coordination failed:', error)
    reportTwilioClientEvent(runtime, 'tab-coordination-unavailable', {
      reason: 'web-lock-request-failed',
      error,
    })
    if (runtime.tabOwnership === ownership) runtime.tabOwnership = null
    runtime.hasDeviceOwnership = false
    update({
      twilioReady: false,
      status: 'Calling unavailable',
      deviceError:
        'Safe call coordination failed. Reload the page before receiving calls.',
    })
  }
}

function releaseTwilioDeviceOwnership(runtime: TwilioRuntime) {
  const ownership = runtime.tabOwnership
  runtime.tabOwnership = null
  runtime.hasDeviceOwnership = false
  ownership?.abortController.abort()
  ownership?.release()
}

function useTwilioLifecycle(runtime: TwilioRuntime, update: UpdateState) {
  const ownTwilioDevice = useCallback(
    () => holdTwilioDeviceOwnership(runtime, update),
    [runtime, update],
  )

  useEffect(() => {
    // The runtime is an intentionally mutable external Twilio SDK controller.
    // eslint-disable-next-line react-hooks/immutability
    runtime.loggedOut = false
    void ownTwilioDevice()
    return () => disposeTwilioRuntime(runtime)
  }, [ownTwilioDevice, runtime])

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
  releaseTwilioDeviceOwnership(runtime)
  closeIncomingNotification(runtime)
  clearMicrophoneMonitoring(runtime)
  runtime.activeCall?.disconnect()
  runtime.activeCall = null
  runtime.acceptingCall = null
  runtime.incomingCall = null
  runtime.tokenRefresh = null
  runtime.deviceRecovery = null
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
    ...getIdleMicrophoneState(),
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
        ...getIdleMicrophoneState(),
      })
    },
    hangupCall: () => {
      if (!runtime.activeCall) return
      runtime.activeCall.disconnect()
      runtime.activeCall = null
      clearMicrophoneMonitoring(runtime)
      update({ callActive: false, ...getIdleMicrophoneState() })
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
