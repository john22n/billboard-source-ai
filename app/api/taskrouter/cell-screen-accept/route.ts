import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Cell Screen Accept — Digit Press Handler
 *
 * Called by Twilio after the worker presses a key in the cell-screen <Gather>.
 *
 * - Digit "1" → return empty <Response/> → Twilio bridges the call through
 * - Anything else → <Hangup/> → cell leg drops → no-answer path kicks in
 */

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const formData = await req.formData()
    const digit = formData.get('Digits') as string | null

    console.log('📱 [CellScreenAccept] Digit pressed:', digit)

    if (digit === '1') {
      console.log('✅ [CellScreenAccept] Accepted — bridging call')
      // Empty response tells Twilio to connect the call
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
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
