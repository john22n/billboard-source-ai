/**
 * Simultaneous Ring TwiML Handler — McDonald only
 *
 * This route is called by Twilio via the TaskRouter `redirect` instruction
 * when a task is assigned to a worker whose Twilio attributes include:
 *   { "simultaneous_ring": true, "cell_phone": "+1XXXXXXXXXX" }
 *
 * It returns a <Dial> TwiML that rings BOTH the worker's GPP2 browser client
 * (via <Client>) and their personal cell phone (via <Number>) simultaneously.
 * The first leg to answer wins; the other drops automatically — standard
 * Twilio multi-noun <Dial> semantics, no bridging or patching required.
 *
 * The <Client> noun has a statusCallback so that if the browser rejects the
 * call, the outbound cell leg is immediately canceled via the REST API rather
 * than continuing to ring until the 20s timeout.
 *
 * A <Parameter name="callerFrom"> is injected into the <Client> noun so the
 * browser client receives the real caller's E.164 number in
 * call.customParameters — regardless of what callerId shows on screen.
 *
 * Query parameters (appended by the assignment callback):
 *   taskSid        — TaskRouter Task SID
 *   workspaceSid   — TaskRouter Workspace SID
 *   clientIdentity — Twilio Client identity string (e.g. "mcdonald")
 *   cellPhone      — E.164 personal cell number (e.g. "+19565551234")
 *   callerFrom     — Real caller E.164 number from task attributes
 */

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);

    const taskSid        = url.searchParams.get('taskSid')        ?? '';
    const workspaceSid   = url.searchParams.get('workspaceSid')   ?? '';
    const clientIdentity = url.searchParams.get('clientIdentity') ?? '';
    const cellPhone      = url.searchParams.get('cellPhone')      ?? '';
    const callerFrom     = url.searchParams.get('callerFrom')     ?? '';

    console.log('═══════════════════════════════════════════');
    console.log('📱 SIMULTANEOUS RING — McDONALD');
    console.log('TaskSid:', taskSid);
    console.log('ClientIdentity:', clientIdentity);
    console.log('CellPhone:', cellPhone.replace(/\d(?=\d{4})/g, '*'));
    console.log('CallerFrom:', callerFrom.replace(/\d(?=\d{4})/g, '*'));
    console.log('═══════════════════════════════════════════');

    if (!clientIdentity || !cellPhone) {
      console.error('❌ Missing clientIdentity or cellPhone — cannot build simultaneous dial TwiML');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const appUrl         = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`
    ).replace(/\/$/, '');
    const callerIdNumber = process.env.TWILIO_MAIN_NUMBER ?? '+18338547126';

    const dialCompleteUrl = new URL(`${appUrl}/api/taskrouter/simultaneous-dial-complete`);
    dialCompleteUrl.searchParams.set('taskSid',      taskSid);
    dialCompleteUrl.searchParams.set('workspaceSid', workspaceSid);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      dialCompleteUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    const clientStatusUrl = new URL(`${appUrl}/api/taskrouter/client-status`);
    clientStatusUrl.searchParams.set('cellPhone', cellPhone);
    clientStatusUrl.searchParams.set('taskSid',   taskSid);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      clientStatusUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    const escapeXml = (s: string): string =>
      s
        .replace(/&/g,  '&amp;')
        .replace(/"/g,  '&quot;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerIdNumber)}"
        timeout="15"
        action="${escapeXml(dialCompleteUrl.toString())}"
        method="POST">
    <Client statusCallback="${escapeXml(clientStatusUrl.toString())}"
            statusCallbackEvent="initiated ringing answered completed"
            statusCallbackMethod="POST">
      <Identity>${escapeXml(clientIdentity)}</Identity>
      <Parameter name="callerFrom" value="${escapeXml(callerFrom)}"/>
    </Client>
    <Number>${escapeXml(cellPhone)}</Number>
  </Dial>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Simultaneous dial TwiML error:', error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}