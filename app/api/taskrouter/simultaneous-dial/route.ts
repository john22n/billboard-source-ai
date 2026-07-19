import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Simultaneous Ring TwiML Handler
 *
 * Returns a <Dial> that rings BOTH the worker's browser client (via <Client>)
 * and their personal cell phone (via <Number>) simultaneously.
 *
 * The <Number> tag uses a `url` attribute pointing to cell-screen, which plays
 * a "Press 1 to accept" prompt when the cell answers. This prevents carrier
 * voicemail from silently stealing the call — voicemail can't press 1, so it
 * times out, the cell leg hangs up, and simultaneous-dial-complete re-enqueues.
 *
 * Query parameters (appended by the assignment callback):
 *   taskSid        — TaskRouter Task SID
 *   workspaceSid   — TaskRouter Workspace SID
 *   clientIdentity — Twilio Client identity string
 *   cellPhone      — E.164 personal cell number
 *   callerFrom     — Real caller E.164 number from task attributes
 *   workerSid      — TaskRouter Worker SID (passed through to dial-complete)
 */

import { serverConfig } from '@/lib/config'

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const url = new URL(req.url)

    const taskSid = url.searchParams.get('taskSid') ?? ''
    const workspaceSid = url.searchParams.get('workspaceSid') ?? ''
    const clientIdentity = url.searchParams.get('clientIdentity') ?? ''
    const cellPhone = url.searchParams.get('cellPhone') ?? ''
    const callerFrom = url.searchParams.get('callerFrom') ?? ''
    const workerSid = url.searchParams.get('workerSid') ?? ''
    const reservationSid = url.searchParams.get('reservationSid') ?? ''

    console.log('═══════════════════════════════════════════')
    console.log('📱 SIMULTANEOUS RING')
    console.log('═══════════════════════════════════════════')

    if (!clientIdentity || !cellPhone) {
      console.error('❌ Missing clientIdentity or cellPhone')
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)
    const businessNumber = serverConfig.twilio.mainNumber ?? '+18338547126'

    const callerId = callerFrom || businessNumber

    // ── dial-complete callback ────────────────────────────────────────────────
    const dialCompleteUrl = new URL(
      `${appUrl}/api/taskrouter/simultaneous-dial-complete`,
    )
    dialCompleteUrl.searchParams.set('taskSid', taskSid)
    dialCompleteUrl.searchParams.set('workspaceSid', workspaceSid)
    dialCompleteUrl.searchParams.set('workerSid', workerSid)
    dialCompleteUrl.searchParams.set('reservationSid', reservationSid)
    serverConfig.app.addVercelBypassToken(dialCompleteUrl)

    // ── browser client status callback ───────────────────────────────────────
    const clientStatusUrl = new URL(`${appUrl}/api/taskrouter/client-status`)
    clientStatusUrl.searchParams.set('cellPhone', cellPhone)
    clientStatusUrl.searchParams.set('taskSid', taskSid)
    serverConfig.app.addVercelBypassToken(clientStatusUrl)

    // ── cell screening URL ────────────────────────────────────────────────────
    const cellScreenUrl = new URL(`${appUrl}/api/taskrouter/cell-screen`)
    cellScreenUrl.searchParams.set('taskSid', taskSid)
    serverConfig.app.addVercelBypassToken(cellScreenUrl)

    // ── recording status callback — tagged as a call recording ───────────────
    const recordingCallbackUrl = new URL(`${appUrl}/api/recordings/call`)
    serverConfig.app.addVercelBypassToken(recordingCallbackUrl)

    const escapeXml = (s: string): string =>
      s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerId)}"
      timeout="15"
      record="record-from-answer"
        recordingStatusCallback="${escapeXml(recordingCallbackUrl.toString())}"
        recordingStatusCallbackMethod="POST"
        action="${escapeXml(dialCompleteUrl.toString())}"
        method="POST">
    <Client statusCallback="${escapeXml(clientStatusUrl.toString())}"
            statusCallbackEvent="initiated ringing answered completed"
            statusCallbackMethod="POST">
      <Identity>${escapeXml(clientIdentity)}</Identity>
      <Parameter name="callerFrom" value="${escapeXml(callerFrom)}"/>
    </Client>
    <Number url="${escapeXml(cellScreenUrl.toString())}"
            method="POST">${escapeXml(cellPhone)}</Number>
  </Dial>
</Response>`

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch {
    console.error('❌ Simultaneous dial TwiML generation failed')
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
