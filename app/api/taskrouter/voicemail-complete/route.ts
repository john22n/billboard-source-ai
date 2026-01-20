/**
 * Voicemail Complete Handler
 *
 * Called after a voicemail recording is completed.
 * Completes the TaskRouter task so the voicemail worker can accept new tasks.
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const callSid = url.searchParams.get('callSid');
    const queueTime = url.searchParams.get('queueTime');

    const formData = await req.formData();
    const recordingSid = formData.get('RecordingSid') as string | null;
    const recordingDuration = formData.get('RecordingDuration') as string | null;
    const recordingUrlRaw = formData.get('RecordingUrl') as string | null;

    const durationSeconds = parseInt(recordingDuration || '0', 10);
    const recordingUrl = recordingUrlRaw
      ? `${recordingUrlRaw}.mp3`
      : null;

    console.log('═══════════════════════════════════════════');
    console.log('📼 VOICEMAIL COMPLETE');
    console.log('TaskSid:', taskSid);
    console.log('WorkspaceSid:', workspaceSid);
    console.log('From:', from);
    console.log('To:', to);
    console.log('CallSid:', callSid);
    console.log('QueueTime:', queueTime, 'seconds');
    console.log('RecordingSid:', recordingSid);
    console.log('RecordingUrl:', recordingUrl);
    console.log('Duration:', durationSeconds, 'seconds');
    console.log('═══════════════════════════════════════════');

    // Complete the TaskRouter task so voicemail worker can accept new tasks
    if (taskSid && workspaceSid) {
      try {
        const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            assignmentStatus: 'completed',
            reason: 'Voicemail recorded',
          });
        console.log('✅ Task completed:', taskSid);
      } catch (err) {
        console.error('⚠️ Failed to complete task (may already be completed):', err);
      }
    }

    // ─────────────────────────────────────────────
    // NO MESSAGE LEFT
    // ─────────────────────────────────────────────
    if (!recordingSid || durationSeconds === 0) {
      console.log('⚠️ No voicemail recorded');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // ─────────────────────────────────────────────
    // SAVE / PROCESS VOICEMAIL
    // ─────────────────────────────────────────────
    // await db.insert(voicemails).values({
    //   callSid,
    //   from,
    //   to,
    //   recordingUrl,
    //   recordingSid,
    //   duration: durationSeconds,
    //   queueTime: parseInt(queueTime || '0', 10),
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
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

