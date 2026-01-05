/**
 * Voicemail Complete Handler
 *
 * Called after a voicemail recording is completed.
 * The TaskRouter task is already canceled at this point.
 */

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const callSid = url.searchParams.get('callSid');
    const queueTime = url.searchParams.get('queueTime');

    const formData = await req.formData();
    const recordingUrl = formData.get('RecordingUrl') as string;
    const recordingSid = formData.get('RecordingSid') as string;
    const recordingDuration = formData.get('RecordingDuration') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📼 VOICEMAIL COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log('From:', from);
    console.log('To:', to);
    console.log('CallSid:', callSid);
    console.log('QueueTime:', queueTime, 'seconds');
    console.log('RecordingSid:', recordingSid);
    console.log('RecordingUrl:', recordingUrl);
    console.log('Duration:', recordingDuration, 'seconds');
    console.log('═══════════════════════════════════════════');

    // TODO: Save voicemail to database
    // await db.insert(voicemails).values({
    //   callSid,
    //   from,
    //   to,
    //   recordingUrl,
    //   recordingSid,
    //   duration: parseInt(recordingDuration || '0'),
    //   queueTime: parseInt(queueTime || '0'),
    //   createdAt: new Date(),
    // });

    console.log('✅ Voicemail recorded successfully');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Thank you for your message. Goodbye.</Say>
  <Hangup/>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Voicemail complete error:', error);
    return new Response('<Response><Hangup/></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
