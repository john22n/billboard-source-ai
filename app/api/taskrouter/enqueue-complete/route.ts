export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const queueResult = formData.get('QueueResult') as string;
    const queueTime = formData.get('QueueTime') as string;
    const callSid = formData.get('CallSid') as string;
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📞 ENQUEUE COMPLETE');
    console.log('QueueResult:', queueResult);
    console.log('QueueTime:', queueTime, 'seconds');
    console.log('CallSid:', callSid);
    console.log('From:', from);
    console.log('═══════════════════════════════════════════');

    // ─────────────────────────────────────────────
    // CALL SUCCESSFULLY CONNECTED
    // ─────────────────────────────────────────────
    if (queueResult === 'bridged') {
      console.log('✅ Call was bridged to worker');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // ─────────────────────────────────────────────
    // CALLER HUNG UP
    // ─────────────────────────────────────────────
    if (queueResult === 'hangup') {
      console.log('📞 Caller hung up while waiting');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // ─────────────────────────────────────────────
    // TIMEOUT / NO AGENTS / REJECTED → VOICEMAIL
    // ─────────────────────────────────────────────
    console.log(`📨 QueueResult="${queueResult}" → voicemail`);

    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;

    const voicemailCompleteUrl = new URL(
      `${appUrl}/api/taskrouter/voicemail-complete`
    );
    voicemailCompleteUrl.searchParams.set('from', from || '');
    voicemailCompleteUrl.searchParams.set('to', to || '');
    voicemailCompleteUrl.searchParams.set('callSid', callSid || '');
    voicemailCompleteUrl.searchParams.set('queueTime', queueTime || '');

    const transcriptionUrl = new URL(
      `${appUrl}/api/taskrouter/voicemail-transcription`
    );
    transcriptionUrl.searchParams.set('from', from || '');
    transcriptionUrl.searchParams.set('to', to || '');
    transcriptionUrl.searchParams.set('callSid', callSid || '');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">
    We're sorry, no one is available to take your call.
    Please leave a message after the beep.
  </Say>
  <Record
    maxLength="120"
    playBeep="true"
    transcribe="true"
    transcribeCallback="${transcriptionUrl}"
    action="${voicemailCompleteUrl}"
    method="POST"
  />
  <Say voice="Polly.Matthew">Goodbye.</Say>
  <Hangup/>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Enqueue complete error:', error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

