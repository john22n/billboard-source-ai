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
 * Query parameters (appended by the assignment callback):
 *   taskSid        — TaskRouter Task SID (used by the action URL for task completion)
 *   workspaceSid   — TaskRouter Workspace SID
 *   clientIdentity — Twilio Client identity string (e.g. "mcdonald"), the part after "client:"
 *   cellPhone      — E.164 personal cell number (e.g. "+19565551234")
 *
 * All other agents are routed through the standard conference instruction
 * in the assignment callback and never reach this endpoint.
 */

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);

    // ── McDonald-specific params set by the assignment callback ──────────────
    const taskSid        = url.searchParams.get('taskSid')        ?? '';
    const workspaceSid   = url.searchParams.get('workspaceSid')   ?? '';
    const clientIdentity = url.searchParams.get('clientIdentity') ?? '';
    const cellPhone      = url.searchParams.get('cellPhone')      ?? '';

    console.log('═══════════════════════════════════════════');
    console.log('📱 SIMULTANEOUS RING — McDONALD');
    console.log('TaskSid:', taskSid);
    console.log('ClientIdentity:', clientIdentity);
    // Mask digits to avoid logging a full phone number
    console.log('CellPhone:', cellPhone.replace(/\d(?=\d{4})/g, '*'));
    console.log('═══════════════════════════════════════════');

    // Safety guard: if params are missing something went wrong upstream
    if (!clientIdentity || !cellPhone) {
      console.error('❌ Missing clientIdentity or cellPhone — cannot build simultaneous dial TwiML');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Use NEXT_PUBLIC_APP_URL when set so the <Dial action> callback URL always
    // resolves to the correct deployment domain rather than the preview hostname
    // that req.url would reflect on a Vercel branch deployment.
    const appUrl         = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`
    ).replace(/\/$/, '');
    const callerIdNumber = process.env.TWILIO_MAIN_NUMBER ?? '+18338547126';

    // The <Dial action> URL is called when the dial attempt finishes
    // (answered+hung-up, no-answer timeout, busy, or failed).
    const dialCompleteUrl = new URL(`${appUrl}/api/taskrouter/simultaneous-dial-complete`);
    dialCompleteUrl.searchParams.set('taskSid',      taskSid);
    dialCompleteUrl.searchParams.set('workspaceSid', workspaceSid);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      dialCompleteUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    // statusCallback for the <Client> noun — fires when the browser client's
    // leg changes status (initiated, ringing, answered, completed).
    // If the browser rejects/dismisses the call, this callback cancels the
    // outbound cell leg immediately instead of waiting for the 20s timeout.
    const clientStatusUrl = new URL(`${appUrl}/api/taskrouter/client-status`);
    clientStatusUrl.searchParams.set('cellPhone', cellPhone);
    clientStatusUrl.searchParams.set('taskSid',   taskSid);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      clientStatusUrl.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    // Escape XML special characters used inside attribute values
    const escapeXml = (s: string): string =>
      s
        .replace(/&/g,  '&amp;')
        .replace(/"/g,  '&quot;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');

    /**
     * TwiML: <Dial> with two simultaneous targets
     *
     * ┌─ <Client> ──────────────────────────────────────────────────────────┐
     * │  McDonald's GPP2 browser endpoint.                                  │
     * │  statusCallback fires on all leg status changes so we can cancel    │
     * │  the cell leg immediately if the browser rejects.                   │
     * └─────────────────────────────────────────────────────────────────────┘
     *
     * ┌─ <Number> ──────────────────────────────────────────────────────────┐
     * │  McDonald's personal cell phone (E.164).                            │
     * │  Sourced from worker attribute `cell_phone` set in Twilio Console.  │
     * └─────────────────────────────────────────────────────────────────────┘
     *
     * Twilio dials both simultaneously. First to answer is bridged to the
     * caller; the other outbound leg is dropped automatically.
     *
     * timeout="20" — matches the reservation timeout used by all other agents
     *                via the conference instruction (see assignment/route.ts).
     */
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerIdNumber)}"
        timeout="20"
        action="${escapeXml(dialCompleteUrl.toString())}"
        method="POST">
    <Client statusCallback="${escapeXml(clientStatusUrl.toString())}"
            statusCallbackEvent="initiated ringing answered completed"
            statusCallbackMethod="POST">${escapeXml(clientIdentity)}</Client>
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