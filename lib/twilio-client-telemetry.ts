export const TWILIO_CLIENT_EVENT_NAMES = [
  'tab-ownership-waiting',
  'tab-ownership-acquired',
  'tab-coordination-unavailable',
  'device-registered',
  'device-error',
  'device-recovery-start',
  'device-recovery-succeeded',
  'device-recovery-failed',
  'call-incoming',
  'call-accept-start',
  'call-accepted',
  'call-accept-ended',
  'call-accept-error',
  'call-disconnected',
  'call-canceled',
  'call-error',
] as const

export type TwilioClientEventName = (typeof TWILIO_CLIENT_EVENT_NAMES)[number]

export const TWILIO_CLIENT_TELEMETRY_LIMITS = {
  tabId: 64,
  reason: 128,
  callSid: 64,
  callDirection: 32,
  callStatus: 32,
  deviceState: 32,
  deviceEdge: 64,
  deviceCallCount: 100,
  deviceCalls: 10,
  errorName: 128,
  errorMessageMaxLength: 500,
  errorCode: 64,
} as const

export interface TwilioCallSnapshot {
  sid: string | null
  direction: string | null
  status: string | null
}

export interface TwilioDeviceSnapshot {
  state: string | null
  isBusy: boolean | null
  edge: string | null
  callCount: number
  calls: TwilioCallSnapshot[]
}

export interface TwilioClientTelemetry {
  event: TwilioClientEventName
  occurredAt: string
  tabId: string
  reason?: string
  device: TwilioDeviceSnapshot
  call?: TwilioCallSnapshot
  error?: {
    name: string
    message: string
    code?: number | string
  }
}

export function sendTwilioClientTelemetry(event: TwilioClientTelemetry) {
  console.info('Twilio client telemetry', event)
  if (typeof window === 'undefined') return

  void fetch('/api/twilio/client-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch((error) =>
    console.warn('Failed to send Twilio client telemetry:', error),
  )
}
