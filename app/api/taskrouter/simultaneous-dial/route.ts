/**
 * Simultaneous Ring TwiML Handler — McDonald only
 *
 * Returns a <Dial> TwiML that rings BOTH the worker's GPP2 browser client
 * (via <Client>) and their personal cell phone (via <Number>) simultaneously.
 *
 * AMD (Answering Machine Detection) is enabled on the <Number> noun.
 * When the cell is answered, Twilio analyzes the audio and fires the
 * amdStatusCallback with AnsweredBy=human or AnsweredBy=machine_*.
 * If machine is detected, amd-status cancels the cell leg and requeues
 * the caller to the next available worker instead of going to voicemail.
 *
 * Query parameters (appended by the assignment callback):
 *   taskSid        — TaskRouter Task SID
 *   workspaceSid   — TaskRouter Workspace SID
 *   clientIdentity — Twilio Client identity string (e.g. "mcdonald")
 *   cellPhone      — E.164 personal cell number
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
      console.error('❌ Missing clientIdentity or cellPhone');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const appUrl = (
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

    // AMD callback — fires when Twilio determines human vs machine on the cell leg
    const amdStatusUrl = new URL(`${appUrl}/api/taskrouter/amd-status`);
    amdStatusUrl.searchParams.set('taskSid',      taskSid);
    amdStatusUrl.searchParams.set('workspaceSid', workspaceSid);
    amdStatusUrl.searchParams.set('cellPhone',    cellPhone);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      amdStatusUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
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
        timeout="20"
        action="${escapeXml(dialCompleteUrl.toString())}"
        method="POST">
    <Client statusCallback="${escapeXml(clientStatusUrl.toString())}"
            statusCallbackEvent="initiated ringing answered completed"
            statusCallbackMethod="POST">
      <Identity>${escapeXml(clientIdentity)}</Identity>
      <Parameter name="callerFrom" value="${escapeXml(callerFrom)}"/>
    </Client>
    <Number machineDetection="Enable"
            amdStatusCallback="${escapeXml(amdStatusUrl.toString())}"
            amdStatusCallbackMethod="POST">${escapeXml(cellPhone)}</Number>
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