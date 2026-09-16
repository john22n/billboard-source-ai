import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Cell Screen — Call Screening Prompt
 *
 * Called by Twilio via the <Number url="..."> attribute in simultaneous-dial
 * when the cell phone answers. Plays a prompt asking the worker to press 1.
 *
 * - Worker presses 1 → cell-screen-accept completes screening → call connects
 * - Worker presses anything else or no input → <Hangup/> → cell leg drops
 *   → simultaneous-dial-complete fires with no-answer → re-enqueues caller
 * - Carrier voicemail answers → can't press 1 → times out → same no-answer path
 */

import { serverConfig } from '@/lib/config'

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)

    // ── action URL for the gather ─────────────────────────────────────────────
    const acceptUrl = new URL(`${appUrl}/api/taskrouter/cell-screen-accept`)
    serverConfig.app.addVercelBypassToken(acceptUrl)

    const escapeXml = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${escapeXml(acceptUrl.toString())}" method="POST" timeout="5">
    <Say voice="Polly.Matthew">Sales call. Press 1.</Say>
  </Gather>
  <Hangup/>
</Response>`

    const formData = await req.clone().formData()
    console.log('📱 [CellScreen] Screening prompt played', {
      at: new Date().toISOString(),
      callSid: String(formData.get('CallSid') ?? '').slice(-8),
      parentCallSid: String(formData.get('ParentCallSid') ?? '').slice(-8),
      taskSid: new URL(req.url).searchParams.get('taskSid')?.slice(-8),
    })

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch {
    console.error('❌ Cell screen failed')
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
