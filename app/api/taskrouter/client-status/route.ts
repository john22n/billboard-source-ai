import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Child-leg Status Callback — Simultaneous Ring
 *
 * Fired by Twilio for every browser and cell child-leg status change inside
 * the simultaneous-dial <Dial>. This callback is observational only: <Dial>
 * owns cancellation of losing legs, avoiding a race where a browser status
 * callback cancels a cell leg while the rep is completing call screening.
 *
 * Query parameters (set by simultaneous-dial/route.ts):
 *   leg       — "browser" or "cell"
 *   taskSid   — TaskRouter Task SID (for logging)
 */

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const url = new URL(req.url)
    const formData = await req.formData()
    console.log('📱 [SimultaneousDialLeg] Status update', {
      at: new Date().toISOString(),
      leg: url.searchParams.get('leg') ?? 'unknown',
      status: formData.get('CallStatus'),
      callSid: String(formData.get('CallSid') ?? '').slice(-8),
      parentCallSid: String(formData.get('ParentCallSid') ?? '').slice(-8),
      taskSid: url.searchParams.get('taskSid')?.slice(-8),
    })

    // Always return 204 — Twilio doesn't need TwiML from a statusCallback
    return new Response(null, { status: 204 })
  } catch {
    console.error('❌ Client status callback failed')
    return new Response(null, { status: 500 })
  }
}
