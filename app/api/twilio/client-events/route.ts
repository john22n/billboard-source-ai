import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import {
  TWILIO_CLIENT_EVENT_NAMES,
  TWILIO_CLIENT_TELEMETRY_LIMITS,
} from '@/lib/twilio-client-telemetry'

const limits = TWILIO_CLIENT_TELEMETRY_LIMITS

const callSnapshotSchema = z.object({
  sid: z.string().max(limits.callSid).nullable(),
  direction: z.string().max(limits.callDirection).nullable(),
  status: z.string().max(limits.callStatus).nullable(),
})

const telemetrySchema = z.object({
  event: z.enum(TWILIO_CLIENT_EVENT_NAMES),
  occurredAt: z.string().datetime(),
  tabId: z.string().min(1).max(limits.tabId),
  reason: z.string().max(limits.reason).optional(),
  device: z.object({
    state: z.string().max(limits.deviceState).nullable(),
    isBusy: z.boolean().nullable(),
    edge: z.string().max(limits.deviceEdge).nullable(),
    callCount: z.number().int().min(0).max(limits.deviceCallCount),
    calls: z.array(callSnapshotSchema).max(limits.deviceCalls),
  }),
  call: callSnapshotSchema.optional(),
  error: z
    .object({
      name: z.string().max(limits.errorName),
      message: z.string().max(limits.errorMessage),
      code: z.union([z.number(), z.string().max(limits.errorCode)]).optional(),
    })
    .optional(),
})

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const attempt = await rateLimit(
    'twilio-client-events',
    session.userId,
    120,
    60,
  )
  if (!attempt.allowed) {
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid telemetry event', { status: 400 })
  }

  const telemetry = telemetrySchema.safeParse(body)
  if (!telemetry.success) {
    return new Response('Invalid telemetry event', { status: 400 })
  }

  console.info('Twilio client telemetry', {
    userId: session.userId,
    ...telemetry.data,
  })
  return new Response(null, { status: 204 })
}
