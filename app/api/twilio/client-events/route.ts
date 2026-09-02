import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { TWILIO_CLIENT_EVENT_NAMES } from '@/lib/twilio-client-telemetry'

const callSnapshotSchema = z.object({
  sid: z.string().max(64).nullable(),
  direction: z.string().max(32).nullable(),
  status: z.string().max(32).nullable(),
})

const telemetrySchema = z.object({
  event: z.enum(TWILIO_CLIENT_EVENT_NAMES),
  occurredAt: z.string().datetime(),
  tabId: z.string().min(1).max(64),
  reason: z.string().max(128).optional(),
  device: z.object({
    state: z.string().max(32).nullable(),
    isBusy: z.boolean().nullable(),
    edge: z.string().max(64).nullable(),
    callCount: z.number().int().min(0).max(100),
    calls: z.array(callSnapshotSchema).max(10),
  }),
  call: callSnapshotSchema.optional(),
  error: z
    .object({
      name: z.string().max(128),
      message: z.string().max(500),
      code: z.union([z.number(), z.string().max(64)]).optional(),
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
