/**
 * Enqueue Complete Handler
 *
 * Called when a call leaves the TaskRouter Enqueue for any reason:
 * - Task was completed (call connected and ended)
 * - Task was canceled (no workers available, timeout)
 * - Caller hung up while waiting
 *
 * If the call wasn't successfully connected, redirects to voicemail.
 */

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const queueResult = formData.get('QueueResult') as string;
    const queueSid = formData.get('QueueSid') as string;
    const queueTime = formData.get('QueueTime') as string;
    const dequeuedCallSid = formData.get('DequeingCallSid') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📞 ENQUEUE COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log('QueueResult:', queueResult, '(type:', typeof queueResult, ')');
    console.log('QueueSid:', queueSid);
    console.log('QueueTime:', queueTime, 'seconds');
    console.log('DequeingCallSid:', dequeuedCallSid || 'N/A');
    console.log('═══════════════════════════════════════════');

    // QueueResult values:
    // - "bridged" = call was successfully connected to a worker
    // - "hangup" = caller hung up while waiting
    // - "leave" = call left queue (canceled, timeout, redirected)
    // - "error" = an error occurred

    if (queueResult === 'bridged') {
      // Call was successfully connected - just hang up cleanly
      console.log('✅ Call was connected to a worker - ending cleanly');
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
      return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    if (queueResult === 'hangup') {
      // Caller hung up - nothing to do
      console.log('📞 Caller hung up while waiting');
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
      return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    if (queueResult === 'redirected') {
      // Call was redirected via assignment instruction (e.g., to voicemail)
      // Return empty response - the redirect instruction already handled the call
      console.log('📨 Call was redirected via assignment - returning empty response');
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response/>`;
      return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // For "leave", "error", or unknown - redirect to voicemail
    console.log('📨 Redirecting to voicemail');
    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;
    const voicemailUrl = `${appUrl}/api/taskrouter/voicemail`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${voicemailUrl}</Redirect>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Enqueue complete error:', error);

    // On error, try to redirect to voicemail
    const url = new URL(req.url);
    const appUrl = `${url.protocol}//${url.host}`;
    const voicemailUrl = `${appUrl}/api/taskrouter/voicemail`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${voicemailUrl}</Redirect>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
