import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Cell Screen Accept — Digit Press Handler
 *
 * Called by Twilio after the worker presses a key in the cell-screen <Gather>.
 *
 * - Digit "1" → complete screening → Twilio bridges the call through
 * - Anything else → <Hangup/> → cell leg drops → no-answer path kicks in
 */

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const formData = await req.formData()
    const digit = formData.get('Digits') as string | null

    console.log('📱 [CellScreenAccept] Digit received', {
      at: new Date().toISOString(),
      digit,
      callSid: String(formData.get('CallSid') ?? '').slice(-8),
      parentCallSid: String(formData.get('ParentCallSid') ?? '').slice(-8),
    })

    if (digit === '1') {
      console.log('✅ [CellScreenAccept] Accepted — bridging call')
      // Complete screening with explicit TwiML before Twilio bridges the leg.
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting.</Say></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    // Wrong digit or no digit — hang up cell leg
    console.log('❌ [CellScreenAccept] Not accepted — hanging up cell leg')
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  } catch {
    console.error('❌ Cell screen acceptance failed')
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
