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
  tokenRefresh: { device: Device; promise: Promise<boolean> } | null
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
  standbyMicrophoneLabel: string
  standbyMicrophonePending: boolean
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
    microphoneCleanup: null,
    microphoneWarning: null,
    microphoneLevel: 0,
    lastMicrophoneLevelUpdate: 0,
    standbyMicrophoneLabel: '',
    standbyMicrophonePending: false,
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

function getStandbyMicrophoneLabel(runtime: TwilioRuntime) {
  return (
    runtime.standbyMicrophoneLabel ||
    runtime.device?.audio?.inputDevice?.label ||
    ''
  )
}

function getIdleMicrophoneState(runtime: TwilioRuntime) {
  return {
    microphoneStatus: 'idle' as const,
    microphoneLevel: 0,
    microphoneLabel: getStandbyMicrophoneLabel(runtime),
    microphoneMessage: null,
  }
}

function getStandbyInputDevice(device: Device) {
  const audio = device.audio
  if (!audio) return undefined

  const selectedInput = audio.inputDevice
  if (selectedInput && selectedInput.deviceId !== 'default') {
    return (
      audio.availableInputDevices.get(selectedInput.deviceId) ?? selectedInput
    )
  }

  const defaultInput = audio.availableInputDevices.get('default')
  const physicalInputs = Array.from(
    audio.availableInputDevices.values(),
  ).filter((input) => input.deviceId !== 'default')
  return (
    physicalInputs.find(
      (input) =>
        defaultInput?.groupId && input.groupId === defaultInput.groupId,
    ) ??
    physicalInputs[0] ??
    selectedInput ??
    defaultInput
  )
}

function isUnknownMicrophoneLabel(label: string) {
  return label === 'Default' || label.startsWith('Unknown Audio Input Device')
}

function canUpdateStandbyMicrophone(runtime: TwilioRuntime, device: Device) {
  return (
    isCurrentDevice(runtime, device) &&
    !runtime.activeCall &&
    !runtime.acceptingCall
  )
}

function publishStandbyMicrophoneLabel(
  runtime: TwilioRuntime,
  update: UpdateState,
  label: string,
) {
  runtime.standbyMicrophoneLabel = label
  update({ microphoneLabel: label })
}

function getMicrophoneRequester(
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
) {
  if (getUserMedia) return getUserMedia
  if (typeof navigator === 'undefined') return undefined
  return navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices)
}

async function readDefaultMicrophoneLabel(
  requestMicrophone: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>,
) {
  const stream = await requestMicrophone({ audio: true })
  try {
    return stream.getAudioTracks()[0]?.label
  } finally {
    stream.getTracks().forEach((track) => track.stop())
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
  if (track?.label) runtime.standbyMicrophoneLabel = track.label

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

export async function acceptIncomingCall(
  runtime: TwilioRuntime,
  update: UpdateState,
  call: Call,
) {
  if (runtime.activeCall === call || runtime.acceptingCall === call) return

  try {
    runtime.acceptingCall = call
    closeIncomingNotification(runtime)
    update({
      status: 'Accepting call...',
      microphoneStatus: 'checking',
      microphoneLevel: 0,
      microphoneLabel: getStandbyMicrophoneLabel(runtime),
      microphoneMessage: 'Connecting to your microphone...',
    })

    const accepted = await waitForCallAcceptance(call)
    // The remote caller can hang up while this accept is still settling. In
    // that case the disconnect handler clears acceptingCall; do not resurrect
    // the already-closed call as active when this promise resumes.
    if (!accepted || runtime.acceptingCall !== call) return
    runtime.activeCall = call
    update({ callActive: true, incomingCall: null })
    monitorCallMicrophone(runtime, update, call)
    runtime.onCallAccepted?.(call)
  } catch (error) {
    console.error('Error accepting Twilio call:', error)
    update({
      status: 'Failed to accept call',
      microphoneStatus: 'disconnected',
      microphoneLevel: 0,
      microphoneLabel: '',
      microphoneMessage:
        'The microphone did not connect. Check browser permission and your input device.',
    })
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
  update({
    incomingCall: call,
    status: `Incoming call from ${call.parameters.From}`,
    ...getIdleMicrophoneState(runtime),
  })
  showIncomingNotification(runtime, update, call)

  call.on('disconnect', () => {
    closeIncomingNotification(runtime)
    if (runtime.acceptingCall === call) runtime.acceptingCall = null
    runtime.activeCall = null
    clearMicrophoneMonitoring(runtime)
    update({
      callActive: false,
      incomingCall: null,
      ...getIdleMicrophoneState(runtime),
    })
    runtime.onCallDisconnected?.()
  })
  call.on('reject', () => {
    closeIncomingNotification(runtime)
    update({ incomingCall: null, ...getIdleMicrophoneState(runtime) })
  })
  call.on('cancel', () => {
    closeIncomingNotification(runtime)
    update({
      incomingCall: null,
      status: 'Call canceled',
      ...getIdleMicrophoneState(runtime),
    })
  })
  call.on('error', (error: Error) => {
    console.error('Twilio call error:', error)
    closeIncomingNotification(runtime)
    update({ incomingCall: null })
  })
}

export async function prepareStandbyMicrophone(
  runtime: TwilioRuntime,
  update: UpdateState,
  device: Device,
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
) {
  if (!canUpdateStandbyMicrophone(runtime, device)) return

  const audio = device.audio
  if (!audio) return
  const inputDevice = getStandbyInputDevice(device)
  if (!inputDevice) return

  if (!isUnknownMicrophoneLabel(inputDevice.label)) {
    publishStandbyMicrophoneLabel(runtime, update, inputDevice.label)
    return
  }

  if (runtime.standbyMicrophonePending) return
  const requestMicrophone = getMicrophoneRequester(getUserMedia)
  if (!requestMicrophone) return

  runtime.standbyMicrophonePending = true
  try {
    const label = await readDefaultMicrophoneLabel(requestMicrophone)
    if (!label || !canUpdateStandbyMicrophone(runtime, device)) return

    publishStandbyMicrophoneLabel(runtime, update, label)
  } catch (error) {
    console.error('Failed to read standby microphone label:', error)
    if (canUpdateStandbyMicrophone(runtime, device)) {
      update({
        microphoneMessage: 'Allow microphone access to show the source label.',
      })
    }
  } finally {
    runtime.standbyMicrophonePending = false
  }
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
  void prepareStandbyMicrophone(runtime, update, device)
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
  device.audio?.on('deviceChange', () => {
    void prepareStandbyMicrophone(runtime, update, device)
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
  clearMicrophoneMonitoring(runtime)
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
    ...getIdleMicrophoneState(runtime),
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
        ...getIdleMicrophoneState(runtime),
      })
    },
    hangupCall: () => {
      if (!runtime.activeCall) return
      runtime.activeCall.disconnect()
      runtime.activeCall = null
      clearMicrophoneMonitoring(runtime)
      update({ callActive: false, ...getIdleMicrophoneState(runtime) })
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
